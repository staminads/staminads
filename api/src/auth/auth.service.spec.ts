import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AuthService } from './auth.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../common/entities/user.entity';
import { Session } from '../common/entities/session.entity';
import { PasswordResetToken } from '../common/entities/password-reset.entity';
import * as crypto from '../common/crypto';

// Mock the crypto module
jest.mock('../common/crypto', () => ({
  generateId: jest.fn(() => 'mock-uuid'),
  generateToken: jest.fn(() => ({
    token: 'mock-token-64-chars',
    hash: 'mock-token-hash',
  })),
  hashToken: jest.fn((token: string) => `hashed-${token}`),
  verifyTokenHash: jest.fn((token: string, hash: string) => hash === `hashed-${token}`),
  hashPassword: jest.fn((password: string) => Promise.resolve(`hashed-${password}`)),
  verifyPassword: jest.fn((password: string, hash: string) =>
    Promise.resolve(hash === `hashed-${password}`)
  ),
}));

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let usersService: jest.Mocked<UsersService>;
  let mailService: jest.Mocked<MailService>;
  let auditService: jest.Mocked<AuditService>;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    password_hash: 'hashed-password123',
    name: 'Test User',
    type: 'user',
    status: 'active',
    is_super_admin: false,
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: '2025-01-01T00:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };

  const mockSession: Session = {
    id: 'session-123',
    user_id: 'user-123',
    token_hash: 'mock-token-hash',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
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
            isLocked: jest.fn(),
            recordLogin: jest.fn(),
            recordFailedLogin: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendPasswordReset: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);
    clickhouse = module.get(ClickHouseService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    auditService = module.get(AuditService);
    cacheManager = module.get(CACHE_MANAGER);

    // Default config mock
    configService.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'APP_URL') return 'http://localhost:5173';
      return defaultValue;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    describe('success with database user', () => {
      beforeEach(() => {
        usersService.isLocked.mockResolvedValue(false);
        usersService.findByEmail.mockResolvedValue(mockUser);
        usersService.recordLogin.mockResolvedValue(undefined);
        clickhouse.insertSystem.mockResolvedValue(undefined);
      });

      it('should return access_token and user info for valid credentials', async () => {
        const result = await service.login(
          { email: 'test@example.com', password: 'password123' },
          '192.168.1.1',
          'Mozilla/5.0',
        );

        expect(result).toEqual({
          access_token: 'mock-jwt-token',
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
            is_super_admin: false,
          },
        });
      });

      it('should normalize email to lowercase', async () => {
        await service.login(
          { email: 'TEST@EXAMPLE.COM', password: 'password123' },
        );

        expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      });

      it('should create a session with IP and user agent', async () => {
        await service.login(
          { email: 'test@example.com', password: 'password123' },
          '192.168.1.1',
          'Mozilla/5.0',
        );

        expect(clickhouse.insertSystem).toHaveBeenCalledWith(
          'sessions',
          expect.arrayContaining([
            expect.objectContaining({
              user_id: 'user-123',
              ip_address: '192.168.1.1',
              user_agent: 'Mozilla/5.0',
            }),
          ]),
        );
      });

      it('should sign JWT with user id, email and session id', async () => {
        await service.login(
          { email: 'test@example.com', password: 'password123' },
        );

        expect(jwtService.sign).toHaveBeenCalledWith({
          sub: 'user-123',
          email: 'test@example.com',
          sessionId: 'mock-uuid',
        });
      });

      it('should record successful login', async () => {
        await service.login(
          { email: 'test@example.com', password: 'password123' },
        );

        expect(usersService.recordLogin).toHaveBeenCalledWith('user-123');
      });
    });

    describe('invalid credentials', () => {
      it('should throw UnauthorizedException for wrong password', async () => {
        usersService.isLocked.mockResolvedValue(false);
        usersService.findByEmail.mockResolvedValue(mockUser);

        await expect(
          service.login({ email: 'test@example.com', password: 'wrongpass' }),
        ).rejects.toThrow(UnauthorizedException);
        await expect(
          service.login({ email: 'test@example.com', password: 'wrongpass' }),
        ).rejects.toThrow('Invalid credentials');
      });

      it('should record failed login attempt on wrong password', async () => {
        usersService.isLocked.mockResolvedValue(false);
        usersService.findByEmail.mockResolvedValue(mockUser);

        try {
          await service.login({ email: 'test@example.com', password: 'wrongpass' });
        } catch (e) {
          // Expected to throw
        }

        expect(usersService.recordFailedLogin).toHaveBeenCalledWith('test@example.com');
      });

      it('should throw UnauthorizedException for non-existent user', async () => {
        usersService.isLocked.mockResolvedValue(false);
        usersService.findByEmail.mockResolvedValue(null);

        await expect(
          service.login({ email: 'notfound@example.com', password: 'password' }),
        ).rejects.toThrow(UnauthorizedException);
        await expect(
          service.login({ email: 'notfound@example.com', password: 'password' }),
        ).rejects.toThrow('Invalid credentials');
      });

      it('should throw UnauthorizedException if user has no password hash', async () => {
        usersService.isLocked.mockResolvedValue(false);
        usersService.findByEmail.mockResolvedValue({
          ...mockUser,
          password_hash: null,
        });

        await expect(
          service.login({ email: 'test@example.com', password: 'password' }),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('should throw UnauthorizedException if user status is not active', async () => {
        usersService.isLocked.mockResolvedValue(false);
        usersService.findByEmail.mockResolvedValue({
          ...mockUser,
          status: 'disabled',
        });

        await expect(
          service.login({ email: 'test@example.com', password: 'password123' }),
        ).rejects.toThrow(UnauthorizedException);
        await expect(
          service.login({ email: 'test@example.com', password: 'password123' }),
        ).rejects.toThrow('Account is not active');
      });
    });

    describe('account locked', () => {
      it('should throw UnauthorizedException if account is locked', async () => {
        usersService.isLocked.mockResolvedValue(true);

        await expect(
          service.login({ email: 'test@example.com', password: 'password123' }),
        ).rejects.toThrow(UnauthorizedException);
        await expect(
          service.login({ email: 'test@example.com', password: 'password123' }),
        ).rejects.toThrow('Account temporarily locked. Try again in 15 minutes.');
      });

      it('should not attempt login if account is locked', async () => {
        usersService.isLocked.mockResolvedValue(true);

        try {
          await service.login({ email: 'test@example.com', password: 'password123' });
        } catch (e) {
          // Expected to throw
        }

        expect(usersService.findByEmail).not.toHaveBeenCalled();
      });
    });
  });

  describe('forgotPassword', () => {
    const mockPasswordResetToken: PasswordResetToken = {
      id: 'reset-123',
      user_id: 'user-123',
      token_hash: 'mock-token-hash',
      status: 'pending',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    describe('sends email', () => {
      beforeEach(() => {
        usersService.findByEmail.mockResolvedValue(mockUser);
        clickhouse.querySystem.mockResolvedValue([{ count: 0 }]);
        clickhouse.insertSystem.mockResolvedValue(undefined);
        mailService.sendPasswordReset.mockResolvedValue(undefined);
        auditService.log.mockResolvedValue({} as any);
      });

      it('should send password reset email for valid user', async () => {
        // Mock workspace query
        clickhouse.querySystem
          .mockResolvedValueOnce([{ count: 0 }]) // Recent requests count
          .mockResolvedValueOnce([{ workspace_id: 'ws-123' }]); // First workspace

        await service.forgotPassword({ email: 'test@example.com' }, '192.168.1.1');

        expect(mailService.sendPasswordReset).toHaveBeenCalledWith(
          'ws-123',
          'test@example.com',
          {
            userName: 'Test User',
            resetUrl: 'http://localhost:5173/reset-password/mock-token-64-chars',
          },
        );
      });

      it('should normalize email to lowercase', async () => {
        clickhouse.querySystem
          .mockResolvedValueOnce([{ count: 0 }])
          .mockResolvedValueOnce([{ workspace_id: 'ws-123' }]);

        await service.forgotPassword({ email: 'TEST@EXAMPLE.COM' });

        expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      });

      it('should create password reset token in database', async () => {
        clickhouse.querySystem
          .mockResolvedValueOnce([{ count: 0 }])
          .mockResolvedValueOnce([{ workspace_id: 'ws-123' }]);

        await service.forgotPassword({ email: 'test@example.com' });

        expect(clickhouse.insertSystem).toHaveBeenCalledWith(
          'password_reset_tokens',
          expect.arrayContaining([
            expect.objectContaining({
              user_id: 'user-123',
              token_hash: 'mock-token-hash',
              status: 'pending',
            }),
          ]),
        );
      });

      it('should log audit event', async () => {
        clickhouse.querySystem
          .mockResolvedValueOnce([{ count: 0 }])
          .mockResolvedValueOnce([{ workspace_id: 'ws-123' }]);

        await service.forgotPassword({ email: 'test@example.com' }, '192.168.1.1');

        expect(auditService.log).toHaveBeenCalledWith({
          user_id: 'user-123',
          workspace_id: undefined,
          action: 'password.reset_requested',
          target_type: 'user',
          target_id: 'user-123',
          metadata: {},
          ip_address: '192.168.1.1',
          user_agent: undefined,
        });
      });

      it('should use empty workspace ID if user has no workspaces', async () => {
        clickhouse.querySystem
          .mockResolvedValueOnce([{ count: 0 }])
          .mockResolvedValueOnce([]); // No workspaces

        await service.forgotPassword({ email: 'test@example.com' });

        expect(mailService.sendPasswordReset).toHaveBeenCalledWith(
          '',
          'test@example.com',
          expect.any(Object),
        );
      });
    });

    describe('rate limiting (3 per hour)', () => {
      beforeEach(() => {
        usersService.findByEmail.mockResolvedValue(mockUser);
      });

      it('should allow request if under rate limit', async () => {
        clickhouse.querySystem
          .mockResolvedValueOnce([{ count: 2 }]) // 2 recent requests
          .mockResolvedValueOnce([{ workspace_id: 'ws-123' }]);
        clickhouse.insertSystem.mockResolvedValue(undefined);
        mailService.sendPasswordReset.mockResolvedValue(undefined);

        await service.forgotPassword({ email: 'test@example.com' });

        expect(mailService.sendPasswordReset).toHaveBeenCalled();
      });

      it('should silently fail if rate limit exceeded', async () => {
        clickhouse.querySystem.mockResolvedValueOnce([{ count: 3 }]); // 3 recent requests

        await service.forgotPassword({ email: 'test@example.com' });

        expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
        expect(clickhouse.insertSystem).not.toHaveBeenCalled();
      });

      it('should not throw error when rate limited', async () => {
        clickhouse.querySystem.mockResolvedValueOnce([{ count: 5 }]);

        await expect(
          service.forgotPassword({ email: 'test@example.com' }),
        ).resolves.toBeUndefined();
      });
    });

    describe('account locked', () => {
      it('should silently fail if account is locked', async () => {
        usersService.isLocked.mockResolvedValue(true);

        await service.forgotPassword({ email: 'test@example.com' });

        expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
        expect(clickhouse.insertSystem).not.toHaveBeenCalled();
      });

      it('should not throw error when account is locked', async () => {
        usersService.isLocked.mockResolvedValue(true);

        await expect(
          service.forgotPassword({ email: 'test@example.com' }),
        ).resolves.toBeUndefined();
      });
    });

    describe('silent fail for unknown email', () => {
      it('should not throw error for non-existent email', async () => {
        usersService.findByEmail.mockResolvedValue(null);

        await expect(
          service.forgotPassword({ email: 'unknown@example.com' }),
        ).resolves.toBeUndefined();
      });

      it('should not send email for non-existent user', async () => {
        usersService.findByEmail.mockResolvedValue(null);

        await service.forgotPassword({ email: 'unknown@example.com' });

        expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
      });

      it('should not create token for non-existent user', async () => {
        usersService.findByEmail.mockResolvedValue(null);

        await service.forgotPassword({ email: 'unknown@example.com' });

        expect(clickhouse.insertSystem).not.toHaveBeenCalled();
      });
    });
  });

  describe('resetPassword', () => {
    const validToken: PasswordResetToken = {
      id: 'reset-123',
      user_id: 'user-123',
      token_hash: 'hashed-valid-token',
      status: 'pending',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    describe('success', () => {
      beforeEach(() => {
        clickhouse.querySystem.mockResolvedValue([validToken]);
        usersService.findById.mockResolvedValue(mockUser);
        clickhouse.insertSystem.mockResolvedValue(undefined);
        auditService.log.mockResolvedValue({} as any);
      });

      it('should update user password', async () => {
        await service.resetPassword(
          { token: 'valid-token', newPassword: 'newpass123' },
          '192.168.1.1',
        );

        expect(clickhouse.insertSystem).toHaveBeenCalledWith(
          'users',
          expect.arrayContaining([
            expect.objectContaining({
              id: 'user-123',
              password_hash: 'hashed-newpass123',
            }),
          ]),
        );
      });

      it('should mark token as used', async () => {
        await service.resetPassword({
          token: 'valid-token',
          newPassword: 'newpass123',
        });

        expect(clickhouse.insertSystem).toHaveBeenCalledWith(
          'password_reset_tokens',
          expect.arrayContaining([
            expect.objectContaining({
              id: 'reset-123',
              status: 'used',
            }),
          ]),
        );
      });

      it('should revoke all sessions', async () => {
        clickhouse.querySystem
          .mockResolvedValueOnce([validToken]) // Token query
          .mockResolvedValueOnce([mockSession, { ...mockSession, id: 'session-456' }]); // Sessions query

        await service.resetPassword({
          token: 'valid-token',
          newPassword: 'newpass123',
        });

        // Should mark both sessions as revoked
        expect(clickhouse.insertSystem).toHaveBeenCalledWith(
          'sessions',
          expect.arrayContaining([
            expect.objectContaining({
              id: 'session-123',
              revoked_at: expect.any(String),
            }),
          ]),
        );
        expect(clickhouse.insertSystem).toHaveBeenCalledWith(
          'sessions',
          expect.arrayContaining([
            expect.objectContaining({
              id: 'session-456',
              revoked_at: expect.any(String),
            }),
          ]),
        );
      });

      it('should log audit event', async () => {
        await service.resetPassword(
          { token: 'valid-token', newPassword: 'newpass123' },
          '192.168.1.1',
        );

        expect(auditService.log).toHaveBeenCalledWith({
          user_id: 'user-123',
          workspace_id: undefined,
          action: 'password.changed',
          target_type: 'user',
          target_id: 'user-123',
          metadata: {},
          ip_address: '192.168.1.1',
          user_agent: undefined,
        });
      });

      it('should invalidate user cache', async () => {
        await service.resetPassword({
          token: 'valid-token',
          newPassword: 'newpass123',
        });

        expect(cacheManager.del).toHaveBeenCalledWith('user:user-123');
      });
    });

    describe('invalid token', () => {
      it('should throw BadRequestException for non-existent token', async () => {
        clickhouse.querySystem.mockResolvedValue([]);

        await expect(
          service.resetPassword({
            token: 'invalid-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.resetPassword({
            token: 'invalid-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow('Invalid or expired reset token');
      });
    });

    describe('expired token', () => {
      it('should throw BadRequestException for expired token', async () => {
        const expiredToken = {
          ...validToken,
          expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        };
        clickhouse.querySystem.mockResolvedValue([expiredToken]);

        await expect(
          service.resetPassword({
            token: 'expired-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.resetPassword({
            token: 'expired-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow('This reset link has expired');
      });
    });

    describe('already used token', () => {
      it('should throw BadRequestException for already used token', async () => {
        const usedToken = {
          ...validToken,
          status: 'used' as const,
        };
        clickhouse.querySystem.mockResolvedValue([usedToken]);

        await expect(
          service.resetPassword({
            token: 'used-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.resetPassword({
            token: 'used-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow('This reset link has already been used');
      });
    });

    describe('user not found', () => {
      it('should throw BadRequestException if user does not exist', async () => {
        clickhouse.querySystem.mockResolvedValue([validToken]);
        usersService.findById.mockResolvedValue(null);

        await expect(
          service.resetPassword({
            token: 'valid-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.resetPassword({
            token: 'valid-token',
            newPassword: 'newpass123',
          }),
        ).rejects.toThrow('User not found');
      });
    });
  });

  describe('createSession', () => {
    beforeEach(() => {
      clickhouse.insertSystem.mockResolvedValue(undefined);
    });

    it('should create session with user ID, IP, and user agent', async () => {
      await service['createSession']('user-123', '192.168.1.1', 'Mozilla/5.0');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'sessions',
        expect.arrayContaining([
          expect.objectContaining({
            user_id: 'user-123',
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
            token_hash: 'mock-token-hash',
          }),
        ]),
      );
    });

    it('should set expiry to 7 days from now', async () => {
      const now = Date.now();
      await service['createSession']('user-123');

      const call = clickhouse.insertSystem.mock.calls[0] as [string, Session[]];
      const session = call[1][0];
      // ClickHouse DateTime format: '2026-01-04 12:54:01.988' - parse as UTC
      const expiresAt = new Date(session.expires_at.replace(' ', 'T') + 'Z');
      const expectedExpiry = new Date(now + 7 * 24 * 60 * 60 * 1000);

      // Allow 1 second tolerance
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });

    it('should handle missing IP and user agent', async () => {
      await service['createSession']('user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'sessions',
        expect.arrayContaining([
          expect.objectContaining({
            ip_address: null,
            user_agent: null,
          }),
        ]),
      );
    });

    it('should return session id and token hash', async () => {
      const result = await service['createSession']('user-123');

      expect(result).toEqual({
        id: 'mock-uuid',
        tokenHash: 'mock-token-hash',
      });
    });
  });

  describe('validateSession', () => {
    it('should return true for valid active session', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSession]);

      const result = await service.validateSession('session-123', 'user-123');

      expect(result).toBe(true);
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id ='),
        { sessionId: 'session-123', userId: 'user-123' },
      );
    });

    it('should return false for non-existent session', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.validateSession('invalid-session', 'user-123');

      expect(result).toBe(false);
    });

    it('should query for active non-revoked sessions only', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSession]);

      await service.validateSession('session-123', 'user-123');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        expect.any(Object),
      );
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('expires_at > now()'),
        expect.any(Object),
      );
    });
  });

  describe('revokeSession', () => {
    it('should revoke specific session', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSession]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.revokeSession('session-123', 'user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'sessions',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'session-123',
            revoked_at: expect.any(String),
          }),
        ]),
      );
    });

    it('should throw BadRequestException if session not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.revokeSession('invalid-session', 'user-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.revokeSession('invalid-session', 'user-123'),
      ).rejects.toThrow('Session not found');
    });

    it('should verify session belongs to user', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSession]);

      await service.revokeSession('session-123', 'user-123');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('user_id ='),
        { sessionId: 'session-123', userId: 'user-123' },
      );
    });

    it('should invalidate session cache', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSession]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.revokeSession('session-123', 'user-123');

      expect(cacheManager.del).toHaveBeenCalledWith('session:session-123:user-123');
    });
  });

  describe('revokeAllSessions', () => {
    it('should revoke all active sessions for user', async () => {
      const sessions = [
        mockSession,
        { ...mockSession, id: 'session-456' },
        { ...mockSession, id: 'session-789' },
      ];
      clickhouse.querySystem.mockResolvedValue(sessions);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.revokeAllSessions('user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalledTimes(3);
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'sessions',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'session-123',
            revoked_at: expect.any(String),
          }),
        ]),
      );
    });

    it('should query only non-revoked sessions', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.revokeAllSessions('user-123');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        { userId: 'user-123' },
      );
    });

    it('should handle user with no active sessions', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.revokeAllSessions('user-123'),
      ).resolves.toBeUndefined();

      expect(clickhouse.insertSystem).not.toHaveBeenCalled();
    });

    it('should invalidate all session caches for user', async () => {
      const sessions = [
        mockSession,
        { ...mockSession, id: 'session-456' },
        { ...mockSession, id: 'session-789' },
      ];
      clickhouse.querySystem.mockResolvedValue(sessions);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.revokeAllSessions('user-123');

      expect(cacheManager.del).toHaveBeenCalledTimes(3);
      expect(cacheManager.del).toHaveBeenCalledWith('session:session-123:user-123');
      expect(cacheManager.del).toHaveBeenCalledWith('session:session-456:user-123');
      expect(cacheManager.del).toHaveBeenCalledWith('session:session-789:user-123');
    });
  });

  describe('listSessions', () => {
    it('should return active sessions for user', async () => {
      const sessions = [
        mockSession,
        { ...mockSession, id: 'session-456', ip_address: '10.0.0.1' },
      ];
      clickhouse.querySystem.mockResolvedValue(sessions);

      const result = await service.listSessions('user-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-123');
      expect(result[1].id).toBe('session-456');
    });

    it('should exclude token_hash from results', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSession]);

      const result = await service.listSessions('user-123');

      expect(result[0]).not.toHaveProperty('token_hash');
    });

    it('should query only active non-revoked sessions', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.listSessions('user-123');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at IS NULL'),
        { userId: 'user-123' },
      );
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('expires_at > now()'),
        { userId: 'user-123' },
      );
    });

    it('should order sessions by created_at DESC', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.listSessions('user-123');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        { userId: 'user-123' },
      );
    });

    it('should return empty array for user with no sessions', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.listSessions('user-123');

      expect(result).toEqual([]);
    });
  });
});
