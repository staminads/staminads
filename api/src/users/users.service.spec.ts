import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersService } from './users.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { User, UserStatus } from '../common/entities/user.entity';
import * as crypto from '../common/crypto';

// Mock the crypto module
jest.mock('../common/crypto');

describe('UsersService', () => {
  let service: UsersService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    password_hash: '$2b$10$hashed.password',
    name: 'Test User',
    type: 'user',
    status: 'active' as UserStatus,
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
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

    service = module.get<UsersService>(UsersService);
    clickhouse = module.get(ClickHouseService);
    cacheManager = module.get(CACHE_MANAGER);

    // Setup default crypto mocks
    (crypto.generateId as jest.Mock).mockReturnValue('new-user-id');
    (crypto.hashPassword as jest.Mock).mockResolvedValue(
      '$2b$10$new.hashed.password',
    );
    (crypto.verifyPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('returns user when found', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      const result = await service.findById('user-123');

      expect(result).toEqual(mockUser);
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = {id:String}'),
        { id: 'user-123' },
      );
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('AND deleted_at IS NULL'),
        expect.any(Object),
      );
    });

    it('returns null when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });

    it('excludes deleted users', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.findById('deleted-user');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('AND deleted_at IS NULL'),
        expect.any(Object),
      );
    });
  });

  describe('findByEmail', () => {
    it('returns user when found', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      const result = await service.findByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE email = {email:String}'),
        { email: 'test@example.com' },
      );
    });

    it('returns null when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('converts email to lowercase before querying', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      await service.findByEmail('TEST@EXAMPLE.COM');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        { email: 'test@example.com' },
      );
    });

    it('excludes deleted users', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.findByEmail('deleted@example.com');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('AND deleted_at IS NULL'),
        expect.any(Object),
      );
    });
  });

  describe('create', () => {
    const createDto = {
      email: 'new@example.com',
      name: 'New User',
      password: 'password123',
    };

    it('creates user successfully', async () => {
      clickhouse.querySystem.mockResolvedValue([]); // No existing user
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(createDto);

      expect(result).toEqual({
        id: 'new-user-id',
        email: 'new@example.com',
        name: 'New User',
        status: 'active',
        created_at: expect.any(String),
      });
    });

    it('converts email to lowercase', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.create({
        ...createDto,
        email: 'NEW@EXAMPLE.COM',
      });

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({ email: 'new@example.com' }),
        ]),
      );
    });

    it('hashes the password', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.create(createDto);

      expect(crypto.hashPassword).toHaveBeenCalledWith('password123');
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            password_hash: '$2b$10$new.hashed.password',
          }),
        ]),
      );
    });

    it('sets default values correctly', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.create(createDto);

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'user',
            status: 'active',
            is_super_admin: 0,
            failed_login_attempts: 0,
            locked_until: null,
            deleted_at: null,
            deleted_by: null,
          }),
        ]),
      );
    });

    it('throws ConflictException when email already exists', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Email already exists',
      );
    });

    it('checks for existing email case-insensitively', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      await expect(
        service.create({
          ...createDto,
          email: 'TEST@EXAMPLE.COM',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateProfile', () => {
    const updateDto = {
      name: 'Updated Name',
      email: 'updated@example.com',
    };

    it('updates user profile successfully', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([mockUser]) // findById
        .mockResolvedValueOnce([]); // email check
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.updateProfile('user-123', updateDto);

      expect(result).toEqual({
        id: 'user-123',
        email: 'updated@example.com',
        name: 'Updated Name',
        status: 'active',
        created_at: mockUser.created_at,
      });
    });

    it('throws NotFoundException when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.updateProfile('non-existent', updateDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateProfile('non-existent', updateDto),
      ).rejects.toThrow('User not found');
    });

    it('converts email to lowercase', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([mockUser])
        .mockResolvedValueOnce([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.updateProfile('user-123', {
        email: 'UPDATED@EXAMPLE.COM',
      });

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({ email: 'updated@example.com' }),
        ]),
      );
    });

    it('throws ConflictException when email already taken', async () => {
      const otherUser = { ...mockUser, id: 'other-user' };
      clickhouse.querySystem
        .mockResolvedValueOnce([mockUser]) // findById
        .mockResolvedValueOnce([otherUser]); // email check

      await expect(
        service.updateProfile('user-123', { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same email', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.updateProfile('user-123', {
        email: mockUser.email,
        name: 'New Name',
      });

      expect(result.email).toBe(mockUser.email);
      // Should not query for duplicate email when keeping same email
      expect(clickhouse.querySystem).toHaveBeenCalledTimes(1);
    });

    it('updates only provided fields', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.updateProfile('user-123', { name: 'New Name' });

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            email: mockUser.email, // unchanged
            name: 'New Name', // updated
          }),
        ]),
      );
    });

    it('updates the updated_at timestamp', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const beforeUpdate = Date.now();
      await service.updateProfile('user-123', { name: 'New Name' });
      const afterUpdate = Date.now();

      const insertCall = clickhouse.insertSystem.mock.calls[0][1][0] as User;
      expect(insertCall.updated_at).toBeDefined();
      // Parse ClickHouse DateTime format
      const updatedAt = new Date(insertCall.updated_at.replace(' ', 'T') + 'Z').getTime();
      expect(updatedAt >= beforeUpdate - 1000).toBe(true);
      expect(updatedAt <= afterUpdate + 1000).toBe(true);
    });

    it('invalidates user cache', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.updateProfile('user-123', { name: 'New Name' });

      expect(cacheManager.del).toHaveBeenCalledWith('user:user-123');
    });
  });

  describe('changePassword', () => {
    const changePasswordDto = {
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
    };

    it('changes password successfully', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      (crypto.verifyPassword as jest.Mock).mockResolvedValue(true);

      await service.changePassword('user-123', changePasswordDto);

      expect(crypto.verifyPassword).toHaveBeenCalledWith(
        'oldpass123',
        mockUser.password_hash,
      );
      expect(crypto.hashPassword).toHaveBeenCalledWith('newpass456');
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            password_hash: '$2b$10$new.hashed.password',
          }),
        ]),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.changePassword('non-existent', changePasswordDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.changePassword('non-existent', changePasswordDto),
      ).rejects.toThrow('User not found');
    });

    it('throws NotFoundException when user has no password hash', async () => {
      const userWithoutPassword = { ...mockUser, password_hash: null };
      clickhouse.querySystem.mockResolvedValue([userWithoutPassword]);

      await expect(
        service.changePassword('user-123', changePasswordDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnauthorizedException for incorrect current password', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      (crypto.verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-123', changePasswordDto),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changePassword('user-123', changePasswordDto),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('throws BadRequestException when new password equals current password', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      (crypto.verifyPassword as jest.Mock).mockResolvedValue(true);

      await expect(
        service.changePassword('user-123', {
          currentPassword: 'samepass',
          newPassword: 'samepass',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changePassword('user-123', {
          currentPassword: 'samepass',
          newPassword: 'samepass',
        }),
      ).rejects.toThrow('New password must be different from current password');
    });

    it('updates password_changed_at timestamp', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      (crypto.verifyPassword as jest.Mock).mockResolvedValue(true);

      const beforeChange = Date.now();
      await service.changePassword('user-123', changePasswordDto);
      const afterChange = Date.now();

      const insertCall = clickhouse.insertSystem.mock.calls[0][1][0] as User;
      expect(insertCall.password_changed_at).toBeDefined();
      // Parse ClickHouse DateTime format
      const changedAt = new Date(insertCall.password_changed_at!.replace(' ', 'T') + 'Z').getTime();
      expect(changedAt >= beforeChange - 1000).toBe(true);
      expect(changedAt <= afterChange + 1000).toBe(true);
    });

    it('invalidates user cache', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      (crypto.verifyPassword as jest.Mock).mockResolvedValue(true);

      await service.changePassword('user-123', changePasswordDto);

      expect(cacheManager.del).toHaveBeenCalledWith('user:user-123');
    });
  });

  describe('recordLogin', () => {
    it('records successful login', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.recordLogin('user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            last_login_at: expect.any(String),
            failed_login_attempts: 0,
            locked_until: null,
          }),
        ]),
      );
    });

    it('resets failed login attempts', async () => {
      const userWithFailedAttempts = {
        ...mockUser,
        failed_login_attempts: 3,
        locked_until: '2025-01-01T01:00:00.000Z',
      };
      clickhouse.querySystem.mockResolvedValue([userWithFailedAttempts]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.recordLogin('user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            failed_login_attempts: 0,
            locked_until: null,
          }),
        ]),
      );
    });

    it('does nothing when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.recordLogin('non-existent');

      expect(clickhouse.insertSystem).not.toHaveBeenCalled();
    });

    it('sets last_login_at to current time', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const before = Date.now();
      await service.recordLogin('user-123');
      const after = Date.now();

      const insertCall = clickhouse.insertSystem.mock.calls[0][1][0] as User;
      expect(insertCall.last_login_at).toBeDefined();
      // Parse ClickHouse DateTime format
      const loginAt = new Date(insertCall.last_login_at!.replace(' ', 'T') + 'Z').getTime();
      expect(loginAt >= before - 1000).toBe(true);
      expect(loginAt <= after + 1000).toBe(true);
    });
  });

  describe('recordFailedLogin', () => {
    it('increments failed login attempts', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.recordFailedLogin('test@example.com');

      expect(result.locked).toBe(false);
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            failed_login_attempts: 1,
            locked_until: null,
          }),
        ]),
      );
    });

    it('locks account after 5 failed attempts', async () => {
      const userWith4Attempts = {
        ...mockUser,
        failed_login_attempts: 4,
      };
      clickhouse.querySystem.mockResolvedValue([userWith4Attempts]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const before = Date.now();
      const result = await service.recordFailedLogin('test@example.com');
      const after = Date.now();

      expect(result.locked).toBe(true);
      expect(result.lockedUntil).toBeDefined();

      // Parse ClickHouse DateTime format
      const lockedUntilTime = new Date(result.lockedUntil!.replace(' ', 'T') + 'Z').getTime();
      const expectedMin = before + 15 * 60 * 1000 - 1000;
      const expectedMax = after + 15 * 60 * 1000 + 1000;

      expect(lockedUntilTime >= expectedMin).toBe(true);
      expect(lockedUntilTime <= expectedMax).toBe(true);
    });

    it('sets failed_login_attempts to 5 when locking', async () => {
      const userWith4Attempts = {
        ...mockUser,
        failed_login_attempts: 4,
      };
      clickhouse.querySystem.mockResolvedValue([userWith4Attempts]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.recordFailedLogin('test@example.com');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            failed_login_attempts: 5,
            locked_until: expect.any(String),
          }),
        ]),
      );
    });

    it('returns not locked when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.recordFailedLogin('nonexistent@example.com');

      expect(result.locked).toBe(false);
      expect(result.lockedUntil).toBeUndefined();
      expect(clickhouse.insertSystem).not.toHaveBeenCalled();
    });

    it('continues incrementing attempts beyond 5', async () => {
      const userWith5Attempts = {
        ...mockUser,
        failed_login_attempts: 5,
        locked_until: '2025-01-01T01:00:00.000Z',
      };
      clickhouse.querySystem.mockResolvedValue([userWith5Attempts]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.recordFailedLogin('test@example.com');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            failed_login_attempts: 6,
          }),
        ]),
      );
    });

    it('invalidates user cache', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.recordFailedLogin('test@example.com');

      expect(cacheManager.del).toHaveBeenCalledWith('user:user-123');
    });
  });

  describe('isLocked', () => {
    it('returns false when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.isLocked('nonexistent@example.com');

      expect(result).toBe(false);
    });

    it('returns false when user has no locked_until', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);

      const result = await service.isLocked('test@example.com');

      expect(result).toBe(false);
    });

    it('returns true when locked_until is in the future', async () => {
      const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const lockedUser = {
        ...mockUser,
        locked_until: futureDate,
      };
      clickhouse.querySystem.mockResolvedValue([lockedUser]);

      const result = await service.isLocked('test@example.com');

      expect(result).toBe(true);
    });

    it('returns false when locked_until is in the past', async () => {
      const pastDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const expiredLockUser = {
        ...mockUser,
        locked_until: pastDate,
      };
      clickhouse.querySystem.mockResolvedValue([expiredLockUser]);

      const result = await service.isLocked('test@example.com');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('soft deletes user successfully', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.delete('user-123', 'admin-user-id');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            deleted_at: expect.any(String),
            deleted_by: 'admin-user-id',
          }),
        ]),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.delete('non-existent', 'admin-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.delete('non-existent', 'admin-id')).rejects.toThrow(
        'User not found',
      );
    });

    it('sets deleted_at to current time', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const before = Date.now();
      await service.delete('user-123', 'admin-id');
      const after = Date.now();

      const insertCall = clickhouse.insertSystem.mock.calls[0][1][0] as User;
      expect(insertCall.deleted_at).toBeDefined();
      // Parse ClickHouse DateTime format
      const deletedAt = new Date(insertCall.deleted_at!.replace(' ', 'T') + 'Z').getTime();
      expect(deletedAt >= before - 1000).toBe(true);
      expect(deletedAt <= after + 1000).toBe(true);
    });

    it('preserves all other user data', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.delete('user-123', 'admin-id');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'users',
        expect.arrayContaining([
          expect.objectContaining({
            id: mockUser.id,
            email: mockUser.email,
            name: mockUser.name,
            password_hash: mockUser.password_hash,
          }),
        ]),
      );
    });

    it('invalidates user cache', async () => {
      clickhouse.querySystem.mockResolvedValue([mockUser]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.delete('user-123', 'admin-id');

      expect(cacheManager.del).toHaveBeenCalledWith('user:user-123');
    });
  });

  describe('toPublicUser', () => {
    it('returns only public fields', () => {
      const result = service.toPublicUser(mockUser);

      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        status: mockUser.status,
        created_at: mockUser.created_at,
      });
    });

    it('excludes sensitive fields', () => {
      const result = service.toPublicUser(mockUser);

      expect(result).not.toHaveProperty('password_hash');
      expect(result).not.toHaveProperty('failed_login_attempts');
      expect(result).not.toHaveProperty('locked_until');
      expect(result).not.toHaveProperty('deleted_at');
    });
  });

  describe('validatePassword', () => {
    it('accepts valid password', () => {
      const result = service.validatePassword('validpass123');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects password shorter than 8 characters', () => {
      const result = service.validatePassword('short');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('rejects password longer than 72 characters', () => {
      const result = service.validatePassword('a'.repeat(73));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at most 72 characters');
    });

    it('accepts password exactly 8 characters', () => {
      const result = service.validatePassword('12345678');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts password exactly 72 characters', () => {
      const result = service.validatePassword('a'.repeat(72));

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns multiple errors for invalid password', () => {
      const result = service.validatePassword('a'.repeat(73));

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
