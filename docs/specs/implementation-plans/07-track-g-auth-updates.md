# Track G: Auth Updates Implementation Plan

**Track:** G - Auth Updates
**Dependencies:** Track A (Users), Track F (Audit)
**Blocks:** None (enables full auth flow)

---

## Overview

This track updates the existing auth system to support multi-user authentication, password reset, session management, and migration from the legacy single-admin system.

---

## Files to Modify/Create

```
api/src/auth/
├── auth.module.ts (modify - add imports)
├── auth.service.ts (modify - multi-user support)
├── auth.controller.ts (modify - new endpoints)
├── strategies/jwt.strategy.ts (modify - user lookup)
├── dto/
│   ├── login.dto.ts (existing)
│   ├── forgot-password.dto.ts (new)
│   └── reset-password.dto.ts (new)
└── entities/
    └── session.entity.ts (use from common)
```

---

## Task 1: New DTOs

### 1.1 Forgot Password DTO

**File:** `api/src/auth/dto/forgot-password.dto.ts`

```typescript
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}
```

### 1.2 Reset Password DTO

**File:** `api/src/auth/dto/reset-password.dto.ts`

```typescript
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
```

---

## Task 2: Update Auth Service

**File:** `api/src/auth/auth.service.ts`

```typescript
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
import { User, Session } from '../common/entities';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const PASSWORD_RESET_EXPIRY_HOURS = 1;
const SESSION_EXPIRY_DAYS = 7;

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
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<{
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
      const sessionToken = await this.createSession(user.id, ipAddress, userAgent);

      const payload = { sub: user.id, email: user.email, sessionId: sessionToken.id };
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
        adminUser = await this.createLegacyAdminUser(email, adminPassword!);
      }

      const sessionToken = await this.createSession(adminUser.id, ipAddress, userAgent);
      const payload = { sub: adminUser.id, email: adminUser.email, sessionId: sessionToken.id };
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
  async forgotPassword(dto: ForgotPasswordDto, ipAddress?: string): Promise<void> {
    const email = dto.email.toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists - just log and return
      this.logger.log(`Password reset requested for non-existent email: ${email}`);
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
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);

    await this.clickhouse.insertSystem('password_reset_tokens', [{
      id: generateId(),
      user_id: user.id,
      token_hash: hash,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }]);

    // Send email
    const baseUrl = this.configService.get<string>('APP_URL', 'http://localhost:5173');

    // Get first workspace for SMTP (or use global)
    const workspaceId = await this.getFirstWorkspaceForUser(user.id);

    await this.mailService.sendPasswordReset(workspaceId || '', email, {
      userName: user.name,
      resetUrl: `${baseUrl}/reset-password/${token}`,
    });

    this.auditService.logPasswordResetRequested(user.id, ipAddress);
  }

  /**
   * Reset password with token
   */
  async resetPassword(dto: ResetPasswordDto, ipAddress?: string): Promise<void> {
    const tokenHash = hashToken(dto.token);

    const result = await this.clickhouse.querySystem<{
      id: string;
      user_id: string;
      status: string;
      expires_at: string;
    }>(`
      SELECT * FROM password_reset_tokens FINAL
      WHERE token_hash = {tokenHash:String}
      LIMIT 1
    `, { tokenHash });

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
    const now = new Date().toISOString();

    await this.clickhouse.insertSystem('users', [{
      ...user,
      password_hash: passwordHash,
      password_changed_at: now,
      updated_at: now,
    }]);

    // Mark token as used
    await this.clickhouse.insertSystem('password_reset_tokens', [{
      ...resetToken,
      status: 'used',
      updated_at: now,
    }]);

    // Optionally revoke all sessions
    await this.revokeAllSessions(user.id);

    this.auditService.logPasswordChanged(user.id, ipAddress);
  }

  /**
   * List active sessions for a user
   */
  async listSessions(userId: string): Promise<Session[]> {
    const result = await this.clickhouse.querySystem<Session>(`
      SELECT * FROM sessions FINAL
      WHERE user_id = {userId:String}
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
    `, { userId });

    // Remove token_hash from response
    return result.map(({ token_hash, ...session }) => session as Session);
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string, userId: string): Promise<void> {
    const result = await this.clickhouse.querySystem<Session>(`
      SELECT * FROM sessions FINAL
      WHERE id = {sessionId:String}
        AND user_id = {userId:String}
      LIMIT 1
    `, { sessionId, userId });

    const session = result[0];
    if (!session) {
      throw new BadRequestException('Session not found');
    }

    await this.clickhouse.insertSystem('sessions', [{
      ...session,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string): Promise<void> {
    const sessions = await this.clickhouse.querySystem<Session>(`
      SELECT * FROM sessions FINAL
      WHERE user_id = {userId:String}
        AND revoked_at IS NULL
    `, { userId });

    const now = new Date().toISOString();

    for (const session of sessions) {
      await this.clickhouse.insertSystem('sessions', [{
        ...session,
        revoked_at: now,
        updated_at: now,
      }]);
    }
  }

  /**
   * Validate a session is still active
   */
  async validateSession(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.clickhouse.querySystem<Session>(`
      SELECT * FROM sessions FINAL
      WHERE id = {sessionId:String}
        AND user_id = {userId:String}
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `, { sessionId, userId });

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
    const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.clickhouse.insertSystem('sessions', [{
      id,
      user_id: userId,
      token_hash: hash,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      expires_at: expiresAt.toISOString(),
      revoked_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }]);

    return { id, tokenHash: hash };
  }

  private async createLegacyAdminUser(email: string, password: string): Promise<User> {
    const id = generateId();
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

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
    const workspaces = await this.clickhouse.querySystem<{ id: string }>(`
      SELECT id FROM workspaces FINAL
      WHERE status = 'active'
    `);

    const now = new Date().toISOString();

    for (const workspace of workspaces) {
      await this.clickhouse.insertSystem('workspace_memberships', [{
        id: generateId(),
        workspace_id: workspace.id,
        user_id: userId,
        role: 'owner',
        invited_by: null,
        joined_at: now,
        created_at: now,
        updated_at: now,
      }]);
    }
  }

  private async getRecentPasswordResetRequests(userId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const result = await this.clickhouse.querySystem<{ count: number }>(`
      SELECT count() as count FROM password_reset_tokens FINAL
      WHERE user_id = {userId:String}
        AND created_at > {oneHourAgo:DateTime64(3)}
    `, { userId, oneHourAgo });

    return result[0]?.count || 0;
  }

  private async getFirstWorkspaceForUser(userId: string): Promise<string | null> {
    const result = await this.clickhouse.querySystem<{ workspace_id: string }>(`
      SELECT workspace_id FROM workspace_memberships FINAL
      WHERE user_id = {userId:String}
      LIMIT 1
    `, { userId });

    return result[0]?.workspace_id || null;
  }
}
```

---

## Task 3: Update Auth Controller

**File:** `api/src/auth/auth.controller.ts`

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Request,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Session } from '../common/entities';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth.login')
  @Public()
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const ipAddress = forwardedFor?.split(',')[0].trim();
    return this.authService.login(dto, ipAddress, userAgent);
  }

  @Post('auth.forgotPassword')
  @Public()
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({ status: 200, description: 'Reset email sent (if email exists)' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ): Promise<{ success: boolean }> {
    const ipAddress = forwardedFor?.split(',')[0].trim();
    await this.authService.forgotPassword(dto, ipAddress);
    return { success: true };
  }

  @Post('auth.resetPassword')
  @Public()
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ): Promise<{ success: boolean }> {
    const ipAddress = forwardedFor?.split(',')[0].trim();
    await this.authService.resetPassword(dto, ipAddress);
    return { success: true };
  }

  @Get('auth.sessions')
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'List active sessions' })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  async sessions(@Request() req): Promise<Session[]> {
    return this.authService.listSessions(req.user.id);
  }

  @Post('auth.revokeSession')
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiQuery({ name: 'sessionId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  async revokeSession(
    @Request() req,
    @Query('sessionId') sessionId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.revokeSession(sessionId, req.user.id);
    return { success: true };
  }

  @Post('auth.revokeAllSessions')
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Logout from all devices' })
  @ApiResponse({ status: 200, description: 'All sessions revoked' })
  async revokeAllSessions(@Request() req): Promise<{ success: boolean }> {
    await this.authService.revokeAllSessions(req.user.id);
    return { success: true };
  }
}
```

---

## Task 4: Update JWT Strategy

**File:** `api/src/auth/strategies/jwt.strategy.ts`

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';

interface JwtPayload {
  sub: string;
  email: string;
  sessionId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Check if session is still valid
    if (payload.sessionId) {
      const isValid = await this.authService.validateSession(
        payload.sessionId,
        payload.sub,
      );
      if (!isValid) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    // Get user from database
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    if (user.deleted_at) {
      throw new UnauthorizedException('Account has been deleted');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.is_super_admin,
    };
  }
}
```

---

## Task 5: Update Auth Module

**File:** `api/src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    MailModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

---

## Task 6: Unit Tests

**File:** `api/src/auth/auth.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let mailService: jest.Mocked<MailService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                ADMIN_EMAIL: 'admin@test.com',
                ADMIN_PASSWORD: 'admin123',
                APP_URL: 'http://localhost:5173',
              };
              return config[key];
            }),
          },
        },
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            isLocked: jest.fn().mockResolvedValue(false),
            recordLogin: jest.fn(),
            recordFailedLogin: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: { sendPasswordReset: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logPasswordResetRequested: jest.fn(),
            logPasswordChanged: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    clickhouse = module.get(ClickHouseService);
    mailService = module.get(MailService);
    jwtService = module.get(JwtService);
  });

  describe('login', () => {
    it('should authenticate database user', async () => {
      const hashedPassword = await require('../common/crypto').hashPassword('password123');
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        password_hash: hashedPassword,
        status: 'active',
      } as any);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.access_token).toBe('jwt-token');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should reject wrong password', async () => {
      const hashedPassword = await require('../common/crypto').hashPassword('correct');
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        password_hash: hashedPassword,
        status: 'active',
      } as any);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.recordFailedLogin).toHaveBeenCalled();
    });

    it('should reject locked accounts', async () => {
      usersService.isLocked.mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('should send reset email for existing user', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test',
      } as any);
      clickhouse.querySystem.mockResolvedValue([{ count: 0 }]); // No rate limit
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendPasswordReset.mockResolvedValue(undefined);

      await service.forgotPassword({ email: 'test@example.com' });

      expect(mailService.sendPasswordReset).toHaveBeenCalled();
    });

    it('should silently succeed for non-existent email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'notfound@example.com' }),
      ).resolves.not.toThrow();

      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const { token, hash } = require('../common/crypto').generateToken();

      clickhouse.querySystem.mockResolvedValueOnce([{
        id: 'reset-1',
        user_id: 'user-1',
        token_hash: hash,
        status: 'pending',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }]);
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      } as any);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      clickhouse.querySystem.mockResolvedValue([]); // No sessions to revoke

      await expect(
        service.resetPassword({ token, newPassword: 'newpassword123' }),
      ).resolves.not.toThrow();
    });

    it('should reject expired token', async () => {
      const { hash } = require('../common/crypto').generateToken();

      clickhouse.querySystem.mockResolvedValue([{
        id: 'reset-1',
        status: 'pending',
        token_hash: hash,
        expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired
      }]);

      await expect(
        service.resetPassword({ token: 'any', newPassword: 'new123456' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('session management', () => {
    it('should list active sessions', async () => {
      clickhouse.querySystem.mockResolvedValue([
        { id: 'session-1', user_id: 'user-1', ip_address: '127.0.0.1' },
      ]);

      const sessions = await service.listSessions('user-1');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).not.toHaveProperty('token_hash');
    });

    it('should revoke a session', async () => {
      clickhouse.querySystem.mockResolvedValue([
        { id: 'session-1', user_id: 'user-1' },
      ]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await expect(
        service.revokeSession('session-1', 'user-1'),
      ).resolves.not.toThrow();
    });
  });
});
```

---

## Deliverables Checklist

- [ ] `api/src/auth/dto/forgot-password.dto.ts`
- [ ] `api/src/auth/dto/reset-password.dto.ts`
- [ ] `api/src/auth/auth.service.ts` (updated)
- [ ] `api/src/auth/auth.controller.ts` (updated)
- [ ] `api/src/auth/strategies/jwt.strategy.ts` (updated)
- [ ] `api/src/auth/auth.module.ts` (updated)
- [ ] `api/src/auth/auth.service.spec.ts`
- [ ] All tests passing
- [ ] OpenAPI spec updated

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `auth.login` | POST | No | Login with email/password |
| `auth.forgotPassword` | POST | No | Request password reset |
| `auth.resetPassword` | POST | No | Reset password with token |
| `auth.sessions` | GET | Yes | List active sessions |
| `auth.revokeSession` | POST | Yes | Revoke specific session |
| `auth.revokeAllSessions` | POST | Yes | Logout all devices |

---

## Acceptance Criteria

1. Database users can log in with email/password
2. Legacy env var admin still works as fallback
3. First legacy admin login creates database user
4. Password reset emails are sent (rate limited)
5. Password reset tokens expire after 1 hour
6. Sessions are tracked in database
7. Sessions can be listed and revoked
8. Session revocation invalidates JWT
9. Failed logins are tracked
10. Account lockout after 5 failed attempts
11. Unit tests have >80% coverage

---

## Migration Notes

### Legacy Admin Behavior

1. If `ADMIN_EMAIL` matches a database user, database auth is used
2. If `ADMIN_EMAIL` doesn't match any user and credentials match env vars:
   - A database user is created with `is_super_admin: true`
   - Owner role is assigned to all existing workspaces
3. After migration, env vars serve only as initial bootstrap

### Backward Compatibility

- Existing JWTs continue to work (no session validation if `sessionId` missing)
- New logins create sessions for proper tracking
- Password change doesn't invalidate old tokens (optional)
