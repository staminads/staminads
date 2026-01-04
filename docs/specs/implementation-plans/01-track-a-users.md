# Track A: Users Module Implementation Plan

**Track:** A - Users Module
**Dependencies:** Phase 0 (Foundation)
**Blocks:** Tracks D (Invitations), E (Members), G (Auth Updates)

---

## Overview

The Users module manages user accounts, profiles, and authentication state. It provides the core user CRUD operations and integrates with the existing auth system.

---

## Files to Create

```
api/src/users/
├── users.module.ts
├── users.service.ts
├── users.controller.ts
├── users.service.spec.ts
├── dto/
│   ├── create-user.dto.ts
│   ├── update-profile.dto.ts
│   └── change-password.dto.ts
└── entities/
    └── (uses common/entities/user.entity.ts)
```

---

## Task 1: Users Module Setup

**File:** `api/src/users/users.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

---

## Task 2: DTOs

### 2.1 Create User DTO

**File:** `api/src/users/dto/create-user.dto.ts`

```typescript
import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt limit
  password: string;

  @IsOptional()
  @IsString()
  invitationToken?: string;
}
```

### 2.2 Update Profile DTO

**File:** `api/src/users/dto/update-profile.dto.ts`

```typescript
import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
```

### 2.3 Change Password DTO

**File:** `api/src/users/dto/change-password.dto.ts`

```typescript
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
```

---

## Task 3: Users Service

**File:** `api/src/users/users.service.ts`

```typescript
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import {
  generateId,
  hashPassword,
  verifyPassword,
} from '../common/crypto';
import { User, PublicUser, UserStatus } from '../common/entities';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UsersService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const result = await this.clickhouse.querySystem<User>(`
      SELECT * FROM users FINAL
      WHERE id = {id:String}
        AND deleted_at IS NULL
      LIMIT 1
    `, { id });

    return result[0] || null;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.clickhouse.querySystem<User>(`
      SELECT * FROM users FINAL
      WHERE email = {email:String}
        AND deleted_at IS NULL
      LIMIT 1
    `, { email: email.toLowerCase() });

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
    const now = new Date().toISOString();

    await this.clickhouse.insertSystem('users', [{
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
    }]);

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
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
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

    const now = new Date().toISOString();
    const updates = {
      ...user,
      email: dto.email?.toLowerCase() || user.email,
      name: dto.name || user.name,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('users', [updates]);

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
    const isValid = await verifyPassword(dto.currentPassword, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Validate new password is different
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const now = new Date().toISOString();
    const newHash = await hashPassword(dto.newPassword);

    await this.clickhouse.insertSystem('users', [{
      ...user,
      password_hash: newHash,
      password_changed_at: now,
      updated_at: now,
    }]);
  }

  /**
   * Record successful login
   */
  async recordLogin(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;

    await this.clickhouse.insertSystem('users', [{
      ...user,
      last_login_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    }]);
  }

  /**
   * Record failed login attempt
   */
  async recordFailedLogin(email: string): Promise<{ locked: boolean; lockedUntil?: string }> {
    const user = await this.findByEmail(email);
    if (!user) {
      return { locked: false };
    }

    const attempts = user.failed_login_attempts + 1;
    const now = new Date();
    let lockedUntil: string | null = null;

    // Lock after 5 failed attempts for 15 minutes
    if (attempts >= 5) {
      lockedUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    }

    await this.clickhouse.insertSystem('users', [{
      ...user,
      failed_login_attempts: attempts,
      locked_until: lockedUntil,
      updated_at: now.toISOString(),
    }]);

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

    return new Date(user.locked_until) > new Date();
  }

  /**
   * Soft delete a user
   */
  async delete(userId: string, deletedBy: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date().toISOString();

    await this.clickhouse.insertSystem('users', [{
      ...user,
      deleted_at: now,
      deleted_by: deletedBy,
      updated_at: now,
    }]);
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
```

---

## Task 4: Users Controller

**File:** `api/src/users/users.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PublicUser } from '../common/entities';

@ApiTags('auth')
@ApiSecurity('jwt-auth')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('auth.me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  async me(@Request() req): Promise<PublicUser> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new Error('User not found');
    }
    return this.usersService.toPublicUser(user);
  }

  @Post('auth.updateProfile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  async updateProfile(
    @Request() req,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Post('auth.changePassword')
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  async changePassword(
    @Request() req,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean }> {
    await this.usersService.changePassword(req.user.id, dto);
    return { success: true };
  }
}
```

---

## Task 5: Unit Tests

**File:** `api/src/users/users.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  beforeEach(async () => {
    const mockClickhouse = {
      querySystem: jest.fn(),
      insertSystem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: ClickHouseService, useValue: mockClickhouse },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    clickhouse = module.get(ClickHouseService);
  });

  describe('findByEmail', () => {
    it('should return user when found', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        status: 'active',
      };
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      const result = await service.findByEmail('test@example.com');
      expect(result).toEqual(mockUser);
    });

    it('should return null when not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.findByEmail('notfound@example.com');
      expect(result).toBeNull();
    });

    it('should normalize email to lowercase', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.findByEmail('TEST@EXAMPLE.COM');
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        { email: 'test@example.com' },
      );
    });
  });

  describe('create', () => {
    it('should create a new user', async () => {
      clickhouse.querySystem.mockResolvedValue([]); // No existing user
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create({
        email: 'new@example.com',
        name: 'New User',
        password: 'password123',
      });

      expect(result.email).toBe('new@example.com');
      expect(result.name).toBe('New User');
      expect(result.status).toBe('active');
      expect(clickhouse.insertSystem).toHaveBeenCalledWith('users', expect.any(Array));
    });

    it('should throw ConflictException if email exists', async () => {
      clickhouse.querySystem.mockResolvedValue([{ id: 'existing' }]);

      await expect(
        service.create({
          email: 'existing@example.com',
          name: 'Test',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('changePassword', () => {
    it('should change password when current password is correct', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        password_hash: '$2b$12$...',  // bcrypt hash
      };
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      // Mock bcrypt comparison (would need proper mock in real test)
      jest.spyOn(service as any, 'findById').mockResolvedValue({
        ...mockUser,
        password_hash: await require('../common/crypto').hashPassword('current123'),
      });

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'current123',
          newPassword: 'newpassword123',
        }),
      ).resolves.not.toThrow();
    });

    it('should throw UnauthorizedException for wrong current password', async () => {
      const hashedPassword = await require('../common/crypto').hashPassword('correct');
      clickhouse.querySystem.mockResolvedValue([{
        id: 'user-1',
        password_hash: hashedPassword,
      }]);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'newpassword123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('isLocked', () => {
    it('should return true when user is locked', async () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      clickhouse.querySystem.mockResolvedValue([{
        id: 'user-1',
        locked_until: futureDate,
      }]);

      const result = await service.isLocked('test@example.com');
      expect(result).toBe(true);
    });

    it('should return false when lock has expired', async () => {
      const pastDate = new Date(Date.now() - 60000).toISOString();
      clickhouse.querySystem.mockResolvedValue([{
        id: 'user-1',
        locked_until: pastDate,
      }]);

      const result = await service.isLocked('test@example.com');
      expect(result).toBe(false);
    });

    it('should return false when user has no lock', async () => {
      clickhouse.querySystem.mockResolvedValue([{
        id: 'user-1',
        locked_until: null,
      }]);

      const result = await service.isLocked('test@example.com');
      expect(result).toBe(false);
    });
  });
});
```

---

## Task 6: Register Module in App

**File:** `api/src/app.module.ts` (modify)

```typescript
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // ... existing imports
    UsersModule,
  ],
})
export class AppModule {}
```

---

## Deliverables Checklist

- [ ] `api/src/users/users.module.ts`
- [ ] `api/src/users/users.service.ts`
- [ ] `api/src/users/users.controller.ts`
- [ ] `api/src/users/dto/create-user.dto.ts`
- [ ] `api/src/users/dto/update-profile.dto.ts`
- [ ] `api/src/users/dto/change-password.dto.ts`
- [ ] `api/src/users/users.service.spec.ts`
- [ ] Module registered in `app.module.ts`
- [ ] All tests passing
- [ ] OpenAPI spec updated

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `auth.me` | GET | Yes | Get current user profile |
| `auth.updateProfile` | POST | Yes | Update name/email |
| `auth.changePassword` | POST | Yes | Change password |

---

## Acceptance Criteria

1. User can be created with email/password/name
2. Duplicate emails are rejected with 409 Conflict
3. User can update their profile (name, email)
4. User can change password (requires current password)
5. Failed login attempts are tracked
6. Account lockout after 5 failed attempts
7. Soft delete preserves data with deleted_at timestamp
8. All queries use FINAL for ClickHouse consistency
9. Passwords are hashed with bcrypt (cost 12)
10. Unit tests have >80% coverage
