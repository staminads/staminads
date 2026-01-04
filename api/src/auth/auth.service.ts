import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import {
  generateId,
  generateToken,
  hashToken,
  verifyTokenHash,
  verifyPassword,
  hashPassword,
} from '../common/crypto';
import { User, Session, PublicSession } from '../common/entities';
import { PasswordResetToken } from '../common/entities/password-reset.entity';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const PASSWORD_RESET_EXPIRY_HOURS = 1;
const SESSION_EXPIRY_DAYS = 7;

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly clickhouse: ClickHouseService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Login with email/password
   * Supports both database users and legacy env var admin
   */
  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    access_token: string;
    user: { id: string; email: string; name: string };
  }> {
    const email = dto.email.toLowerCase();

    // Check if user is locked
    if (await this.usersService.isLocked(email)) {
      throw new UnauthorizedException(
        'Account temporarily locked. Try again in 15 minutes.',
      );
    }

    // Try database user first
    const user = await this.usersService.findByEmail(email);

    if (user) {
      // Database user authentication
      if (!user.password_hash) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (user.status !== 'active') {
        throw new UnauthorizedException('Account is not active');
      }

      const isValid = await verifyPassword(dto.password, user.password_hash);
      if (!isValid) {
        await this.usersService.recordFailedLogin(email);
        throw new UnauthorizedException('Invalid credentials');
      }

      // Record successful login
      await this.usersService.recordLogin(user.id);

      // Create session
      const session = await this.createSession(user.id, ipAddress, userAgent);

      const payload = {
        sub: user.id,
        email: user.email,
        sessionId: session.id,
      };
      const accessToken = this.jwtService.sign(payload);

      return {
        access_token: accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }

    // Fallback to legacy env var admin
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');

    if (email === adminEmail?.toLowerCase() && dto.password === adminPassword) {
      // Legacy admin - create or get admin user
      let adminUser = await this.usersService.findByEmail(email);

      if (!adminUser) {
        // First login - create admin user
        adminUser = await this.createLegacyAdminUser(email, adminPassword);
      }

      const session = await this.createSession(
        adminUser.id,
        ipAddress,
        userAgent,
      );
      const payload = {
        sub: adminUser.id,
        email: adminUser.email,
        sessionId: session.id,
      };
      const accessToken = this.jwtService.sign(payload);

      return {
        access_token: accessToken,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
        },
      };
    }

    throw new UnauthorizedException('Invalid credentials');
  }

  /**
   * Request password reset
   * Always returns success to prevent email enumeration
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    ipAddress?: string,
  ): Promise<void> {
    const email = dto.email.toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists - just log and return
      this.logger.log(
        `Password reset requested for non-existent email: ${email}`,
      );
      return;
    }

    // Rate limit: 3 requests per hour
    const recentRequests = await this.getRecentPasswordResetRequests(user.id);
    if (recentRequests >= 3) {
      this.logger.warn(`Rate limit exceeded for password reset: ${email}`);
      return; // Silent fail to prevent enumeration
    }

    // Generate reset token
    const { token, hash } = generateToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    await this.clickhouse.insertSystem('password_reset_tokens', [
      {
        id: generateId(),
        user_id: user.id,
        token_hash: hash,
        status: 'pending',
        expires_at: toClickHouseDateTime(expiresAt),
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      },
    ]);

    // Send email
    const baseUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:5173',
    );

    // Get first workspace for SMTP (or use global)
    const workspaceId = await this.getFirstWorkspaceForUser(user.id);

    await this.mailService.sendPasswordReset(workspaceId || '', email, {
      userName: user.name,
      resetUrl: `${baseUrl}/reset-password/${token}`,
    });

    // Log audit event
    await this.auditService.log({
      user_id: user.id,
      workspace_id: undefined,
      action: 'password.reset_requested',
      target_type: 'user',
      target_id: user.id,
      metadata: {},
      ip_address: ipAddress,
      user_agent: undefined,
    });
  }

  /**
   * Reset password with token
   */
  async resetPassword(
    dto: ResetPasswordDto,
    ipAddress?: string,
  ): Promise<void> {
    const tokenHash = hashToken(dto.token);

    const result = await this.clickhouse.querySystem<PasswordResetToken>(
      `
      SELECT * FROM password_reset_tokens FINAL
      WHERE token_hash = {tokenHash:String}
      LIMIT 1
    `,
      { tokenHash },
    );

    const resetToken = result[0];

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (resetToken.status !== 'pending') {
      throw new BadRequestException('This reset link has already been used');
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      throw new BadRequestException('This reset link has expired');
    }

    // Get user
    const user = await this.usersService.findById(resetToken.user_id);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Update password
    const passwordHash = await hashPassword(dto.newPassword);
    const now = toClickHouseDateTime();

    await this.clickhouse.insertSystem('users', [
      {
        ...user,
        password_hash: passwordHash,
        password_changed_at: now,
        updated_at: now,
      },
    ]);

    // Mark token as used
    await this.clickhouse.insertSystem('password_reset_tokens', [
      {
        ...resetToken,
        status: 'used',
        updated_at: now,
      },
    ]);

    // Revoke all sessions
    await this.revokeAllSessions(user.id);

    // Log audit event
    await this.auditService.log({
      user_id: user.id,
      workspace_id: undefined,
      action: 'password.changed',
      target_type: 'user',
      target_id: user.id,
      metadata: {},
      ip_address: ipAddress,
      user_agent: undefined,
    });
  }

  /**
   * List active sessions for a user
   */
  async listSessions(userId: string): Promise<PublicSession[]> {
    const result = await this.clickhouse.querySystem<Session>(
      `
      SELECT * FROM sessions FINAL
      WHERE user_id = {userId:String}
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
    `,
      { userId },
    );

    // Remove token_hash from response
    return result.map(({ token_hash, ...session }) => session as PublicSession);
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string, userId: string): Promise<void> {
    const result = await this.clickhouse.querySystem<Session>(
      `
      SELECT * FROM sessions FINAL
      WHERE id = {sessionId:String}
        AND user_id = {userId:String}
      LIMIT 1
    `,
      { sessionId, userId },
    );

    const session = result[0];
    if (!session) {
      throw new BadRequestException('Session not found');
    }

    const now = toClickHouseDateTime();
    await this.clickhouse.insertSystem('sessions', [
      {
        ...session,
        revoked_at: now,
        updated_at: now,
      },
    ]);
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string): Promise<void> {
    const sessions = await this.clickhouse.querySystem<Session>(
      `
      SELECT * FROM sessions FINAL
      WHERE user_id = {userId:String}
        AND revoked_at IS NULL
    `,
      { userId },
    );

    const now = toClickHouseDateTime();

    for (const session of sessions) {
      await this.clickhouse.insertSystem('sessions', [
        {
          ...session,
          revoked_at: now,
          updated_at: now,
        },
      ]);
    }
  }

  /**
   * Validate a session is still active
   */
  async validateSession(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.clickhouse.querySystem<Session>(
      `
      SELECT * FROM sessions FINAL
      WHERE id = {sessionId:String}
        AND user_id = {userId:String}
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
      { sessionId, userId },
    );

    return result.length > 0;
  }

  private async createSession(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ id: string; tokenHash: string }> {
    const id = generateId();
    const { token, hash } = generateToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.clickhouse.insertSystem('sessions', [
      {
        id,
        user_id: userId,
        token_hash: hash,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        expires_at: toClickHouseDateTime(expiresAt),
        revoked_at: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      },
    ]);

    return { id, tokenHash: hash };
  }

  private async createLegacyAdminUser(
    email: string,
    password: string,
  ): Promise<User> {
    const id = generateId();
    const passwordHash = await hashPassword(password);
    const now = toClickHouseDateTime();

    const user: User = {
      id,
      email,
      password_hash: passwordHash,
      name: 'Admin',
      type: 'user',
      status: 'active',
      is_super_admin: true, // Legacy admin is super admin
      last_login_at: now,
      failed_login_attempts: 0,
      locked_until: null,
      password_changed_at: now,
      deleted_at: null,
      deleted_by: null,
      created_at: now,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('users', [user]);

    // Assign owner role to all existing workspaces
    await this.assignOwnerToExistingWorkspaces(id);

    return user;
  }

  private async assignOwnerToExistingWorkspaces(userId: string): Promise<void> {
    const workspaces = await this.clickhouse.querySystem<{ id: string }>(
      `
      SELECT id FROM workspaces
      WHERE status = 'active'
    `,
    );

    const now = toClickHouseDateTime();

    for (const workspace of workspaces) {
      await this.clickhouse.insertSystem('workspace_memberships', [
        {
          id: generateId(),
          workspace_id: workspace.id,
          user_id: userId,
          role: 'owner',
          invited_by: null,
          joined_at: now,
          created_at: now,
          updated_at: now,
        },
      ]);
    }
  }

  private async getRecentPasswordResetRequests(
    userId: string,
  ): Promise<number> {
    const oneHourAgo = toClickHouseDateTime(
      new Date(Date.now() - 60 * 60 * 1000),
    );

    const result = await this.clickhouse.querySystem<{ count: number }>(
      `
      SELECT count() as count FROM password_reset_tokens FINAL
      WHERE user_id = {userId:String}
        AND created_at > {oneHourAgo:DateTime64(3)}
    `,
      { userId, oneHourAgo },
    );

    return result[0]?.count || 0;
  }

  private async getFirstWorkspaceForUser(
    userId: string,
  ): Promise<string | null> {
    const result = await this.clickhouse.querySystem<{ workspace_id: string }>(
      `
      SELECT workspace_id FROM workspace_memberships FINAL
      WHERE user_id = {userId:String}
      LIMIT 1
    `,
      { userId },
    );

    return result[0]?.workspace_id || null;
  }
}
