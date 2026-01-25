import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ClickHouseService } from '../database/clickhouse.service';
import { generateId, hashPassword, verifyPassword } from '../common/crypto';
import { User, PublicUser, UserStatus } from '../common/entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  toClickHouseDateTime,
  parseClickHouseDateTime,
} from '../common/utils/datetime.util';

@Injectable()
export class UsersService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const result = await this.clickhouse.querySystem<User>(
      `
      SELECT * FROM users FINAL
      WHERE id = {id:String}
        AND deleted_at IS NULL
      LIMIT 1
    `,
      { id },
    );

    return result[0] || null;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.clickhouse.querySystem<User>(
      `
      SELECT * FROM users FINAL
      WHERE email = {email:String}
        AND deleted_at IS NULL
      LIMIT 1
    `,
      { email: email.toLowerCase() },
    );

    return result[0] || null;
  }

  /**
   * Create a new user
   */
  async create(dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();

    // Check for existing user
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const id = generateId();
    const passwordHash = await hashPassword(dto.password);
    const now = toClickHouseDateTime();

    await this.clickhouse.insertSystem('users', [
      {
        id,
        email,
        password_hash: passwordHash,
        name: dto.name,
        type: 'user',
        status: 'active' as UserStatus,
        is_super_admin: 0,
        last_login_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        password_changed_at: now,
        deleted_at: null,
        deleted_by: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    return {
      id,
      email,
      name: dto.name,
      status: 'active',
      created_at: now,
    };
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check email uniqueness if changing email
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.findByEmail(dto.email);
      if (existing) {
        throw new ConflictException('Email already exists');
      }
    }

    const now = toClickHouseDateTime();
    const updates = {
      ...user,
      email: dto.email?.toLowerCase() || user.email,
      name: dto.name || user.name,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('users', [updates]);

    // Invalidate user cache
    await this.invalidateUserCache(userId);

    return {
      id: user.id,
      email: updates.email,
      name: updates.name,
      status: user.status,
      created_at: user.created_at,
    };
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findById(userId);
    if (!user || !user.password_hash) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isValid = await verifyPassword(
      dto.currentPassword,
      user.password_hash,
    );
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Validate new password is different
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const now = toClickHouseDateTime();
    const newHash = await hashPassword(dto.newPassword);

    await this.clickhouse.insertSystem('users', [
      {
        ...user,
        password_hash: newHash,
        password_changed_at: now,
        updated_at: now,
      },
    ]);

    // Invalidate user cache
    await this.invalidateUserCache(userId);
  }

  /**
   * Record successful login
   */
  async recordLogin(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;

    const now = toClickHouseDateTime();
    await this.clickhouse.insertSystem('users', [
      {
        ...user,
        last_login_at: now,
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: now,
      },
    ]);
  }

  /**
   * Record failed login attempt
   */
  async recordFailedLogin(
    email: string,
  ): Promise<{ locked: boolean; lockedUntil?: string }> {
    const user = await this.findByEmail(email);
    if (!user) {
      return { locked: false };
    }

    const attempts = user.failed_login_attempts + 1;
    const now = new Date();
    let lockedUntil: string | null = null;

    // Lock after 5 failed attempts for 15 minutes
    if (attempts >= 5) {
      lockedUntil = toClickHouseDateTime(
        new Date(now.getTime() + 15 * 60 * 1000),
      );
    }

    await this.clickhouse.insertSystem('users', [
      {
        ...user,
        failed_login_attempts: attempts,
        locked_until: lockedUntil,
        updated_at: toClickHouseDateTime(now),
      },
    ]);

    // Invalidate user cache (status may have changed to locked)
    await this.invalidateUserCache(user.id);

    return {
      locked: !!lockedUntil,
      lockedUntil: lockedUntil || undefined,
    };
  }

  /**
   * Check if user is locked out
   */
  async isLocked(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user || !user.locked_until) {
      return false;
    }

    const lockedUntil = parseClickHouseDateTime(user.locked_until);
    return lockedUntil > new Date();
  }

  /**
   * Soft delete a user
   */
  async delete(userId: string, deletedBy: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = toClickHouseDateTime();

    await this.clickhouse.insertSystem('users', [
      {
        ...user,
        deleted_at: now,
        deleted_by: deletedBy,
        updated_at: now,
      },
    ]);

    // Invalidate user cache
    await this.invalidateUserCache(userId);
  }

  /**
   * Invalidate user cache entry
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await this.cacheManager.del(`user:${userId}`);
  }

  /**
   * Get public user info (safe for API responses)
   */
  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      created_at: user.created_at,
    };
  }

  /**
   * Validate password meets requirements
   */
  validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 8) {
      errors.push('Password must be at least 8 characters');
    }

    if (password.length > 72) {
      errors.push('Password must be at most 72 characters');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
