import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { MembersService } from '../members/members.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ListApiKeysDto } from './dto/list-api-keys.dto';
import { RevokeApiKeyDto } from './dto/revoke-api-key.dto';
import { ApiKey } from '../common/entities/api-key.entity';
import * as crypto from '../common/crypto';

// Mock the crypto module
jest.mock('../common/crypto', () => ({
  generateId: jest.fn(),
  generateApiKeyToken: jest.fn(),
  hashToken: jest.fn(),
}));

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let membersService: jest.Mocked<MembersService>;

  const mockApiKey: ApiKey = {
    id: 'key-test-001',
    key_hash: 'hash123',
    key_prefix: 'stam_live_abc1234',
    user_id: 'user-001',
    workspace_id: 'ws-001',
    name: 'Test API Key',
    description: 'Test description',
    scopes: ['events.track', 'analytics.view'],
    status: 'active',
    expires_at: null,
    last_used_at: null,
    failed_attempts_count: 0,
    last_failed_attempt_at: null,
    created_by: 'user-001',
    revoked_by: null,
    revoked_at: null,
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  // ClickHouse stores scopes as JSON string
  const mockApiKeyRow = {
    ...mockApiKey,
    scopes: JSON.stringify(mockApiKey.scopes),
  };

  // Mock membership for permission checks
  const mockMembership = {
    id: 'membership-001',
    workspace_id: 'ws-001',
    user_id: 'user-001',
    role: 'owner' as const,
    invited_by: null,
    joined_at: '2025-01-01 00:00:00',
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
            commandSystem: jest.fn(),
          },
        },
        {
          provide: MembersService,
          useValue: {
            getMembership: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    clickhouse = module.get(ClickHouseService);
    membersService = module.get(MembersService);

    // Setup default mocks for crypto functions
    (crypto.generateId as jest.Mock).mockReturnValue('key-new-001');
    (crypto.generateApiKeyToken as jest.Mock).mockReturnValue({
      key: 'stam_live_0000000000000000000000000000000000000000000000000000000000000000',
      hash: 'hash_of_the_key',
      prefix: 'stam_live_000000',
    });
    (crypto.hashToken as jest.Mock).mockReturnValue('hash_of_the_key');

    // Default: user has permission to create API keys
    membersService.getMembership.mockResolvedValue(mockMembership);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to satisfy TypeScript for create method
  type CreateDto = CreateApiKeyDto & { user_id: string };

  describe('create', () => {
    it('generates a new API key and stores hash', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'My API Key',
        description: 'For production use',
        scopes: ['events.track'],
      };

      const result = await service.create(dto, 'user-001');

      expect(result.key).toBe(
        'stam_live_0000000000000000000000000000000000000000000000000000000000000000',
      );
      expect(result.apiKey.id).toBe('key-new-001');
      expect(result.apiKey.name).toBe('My API Key');
      expect(result.apiKey.scopes).toEqual(['events.track']);
      expect(result.apiKey.status).toBe('active');
      expect(result.apiKey).not.toHaveProperty('key_hash');
    });

    it('calls generateId and generateApiKeyToken', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      await service.create(dto, 'user-001');

      expect(crypto.generateId).toHaveBeenCalled();
      expect(crypto.generateApiKeyToken).toHaveBeenCalled();
    });

    it('stores API key with hash in ClickHouse', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['events.track', 'analytics.view'],
      };

      await service.create(dto, 'user-001');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'key-new-001',
            key_hash: 'hash_of_the_key',
            key_prefix: 'stam_live_000000',
            user_id: 'user-001',
            workspace_id: 'ws-001',
            name: 'Test Key',
            scopes: JSON.stringify(['events.track', 'analytics.view']),
            status: 'active',
          }),
        ]),
      );
    });

    it('returns full key only once in response', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      const result = await service.create(dto, 'user-001');

      // Full key is returned in response
      expect(result.key).toBeDefined();
      expect(result.key).toContain('stam_live_');

      // But apiKey object does not contain key_hash
      expect(result.apiKey).not.toHaveProperty('key_hash');
    });

    it('handles optional fields correctly', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Simple Key',
        scopes: ['analytics.view'],
      };

      const result = await service.create(dto, 'user-001');

      expect(result.apiKey.description).toBe('');
      expect(result.apiKey.expires_at).toBeNull();
    });

    it('sets description to empty string when not provided', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      await service.create(dto, 'user-001');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.arrayContaining([
          expect.objectContaining({
            description: '',
          }),
        ]),
      );
    });

    it('handles expires_at when provided', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const expiryDate = '2026-12-31T23:59:59.000Z';
      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Expiring Key',
        scopes: ['analytics.view'],
        expires_at: expiryDate,
      };

      const result = await service.create(dto, 'user-001');

      expect(result.apiKey.expires_at).toBe(expiryDate);
    });

    it('sets created_by from parameter', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      await service.create(dto, 'admin-user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.arrayContaining([
          expect.objectContaining({
            created_by: 'admin-user-123',
          }),
        ]),
      );
    });

    it('initializes security fields correctly', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      await service.create(dto, 'user-001');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.arrayContaining([
          expect.objectContaining({
            last_used_at: null,
            failed_attempts_count: 0,
            last_failed_attempt_at: null,
            revoked_by: null,
            revoked_at: null,
          }),
        ]),
      );
    });

    it('throws ForbiddenException when user is not a member', async () => {
      membersService.getMembership.mockResolvedValue(null);

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      await expect(service.create(dto, 'user-001')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when user lacks integrations.manage permission', async () => {
      membersService.getMembership.mockResolvedValue({
        ...mockMembership,
        role: 'viewer',
      });

      const dto: CreateDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        name: 'Test Key',
        scopes: ['analytics.view'],
      };

      await expect(service.create(dto, 'user-001')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('list', () => {
    it('returns all keys when no filters provided', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const result = await service.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('key-test-001');
      expect(result[0].name).toBe('Test API Key');
      expect(result[0]).not.toHaveProperty('key_hash');
    });

    it('filters by user_id', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const dto: ListApiKeysDto = {
        user_id: 'user-001',
      };

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('user_id = {user_id:String}'),
        expect.objectContaining({ user_id: 'user-001' }),
      );
    });

    it('filters by workspace_id', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const dto: ListApiKeysDto = {
        workspace_id: 'ws-001',
      };

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('workspace_id = {workspace_id:String}'),
        expect.objectContaining({ workspace_id: 'ws-001' }),
      );
    });

    it('filters by status', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const dto: ListApiKeysDto = {
        status: 'active',
      };

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('status = {status:String}'),
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('combines multiple filters', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const dto: ListApiKeysDto = {
        user_id: 'user-001',
        workspace_id: 'ws-001',
        status: 'active',
      };

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('user_id = {user_id:String}'),
        expect.objectContaining({
          user_id: 'user-001',
          workspace_id: 'ws-001',
          status: 'active',
        }),
      );
    });

    it('handles workspace_id null filter', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const dto: ListApiKeysDto = {
        workspace_id: null as any,
      };

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('workspace_id IS NULL'),
        expect.any(Object),
      );
    });

    it('returns empty array when no keys found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual([]);
    });

    it('parses scopes JSON correctly', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const result = await service.list();

      expect(result[0].scopes).toEqual(['events.track', 'analytics.view']);
      expect(Array.isArray(result[0].scopes)).toBe(true);
    });

    it('excludes key_hash from returned objects', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const result = await service.list();

      expect(result[0]).not.toHaveProperty('key_hash');
    });

    it('orders results by created_at DESC', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      await service.list();

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Object),
      );
    });

    it('gets latest version of each key', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      await service.list();

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining(
          '(id, updated_at) IN (',
        ),
        expect.any(Object),
      );
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT id, max(updated_at) FROM api_keys GROUP BY id',
        ),
        expect.any(Object),
      );
    });
  });

  describe('get', () => {
    it('returns single key by id', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const result = await service.get('key-test-001');

      expect(result.id).toBe('key-test-001');
      expect(result.name).toBe('Test API Key');
      expect(result).not.toHaveProperty('key_hash');
    });

    it('queries ClickHouse with correct parameters', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      await service.get('key-test-001');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = {id:String}'),
        { id: 'key-test-001' },
      );
    });

    it('gets latest version by updated_at', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      await service.get('key-test-001');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY updated_at DESC LIMIT 1'),
        expect.any(Object),
      );
    });

    it('throws NotFoundException when key not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.get('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException with correct message', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.get('key-404')).rejects.toThrow(
        'API key key-404 not found',
      );
    });

    it('parses scopes JSON correctly', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const result = await service.get('key-test-001');

      expect(result.scopes).toEqual(['events.track', 'analytics.view']);
      expect(Array.isArray(result.scopes)).toBe(true);
    });

    it('excludes key_hash from returned object', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);

      const result = await service.get('key-test-001');

      expect(result).not.toHaveProperty('key_hash');
    });
  });

  describe('revoke', () => {
    it('marks key as revoked', async () => {
      // First get call
      clickhouse.querySystem.mockResolvedValueOnce([mockApiKeyRow]);
      // Second get call inside revoke
      clickhouse.querySystem.mockResolvedValueOnce([mockApiKeyRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: RevokeApiKeyDto = {
        id: 'key-test-001',
        revoked_by: 'admin-user',
      };

      const result = await service.revoke(dto);

      expect(result.status).toBe('revoked');
      expect(result.revoked_by).toBe('admin-user');
      expect(result.revoked_at).toBeDefined();
    });

    it('throws NotFoundException when key not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const dto: RevokeApiKeyDto = {
        id: 'non-existent',
        revoked_by: 'admin-user',
      };

      await expect(service.revoke(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with correct message', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const dto: RevokeApiKeyDto = {
        id: 'key-404',
        revoked_by: 'admin-user',
      };

      await expect(service.revoke(dto)).rejects.toThrow(
        'API key key-404 not found',
      );
    });

    it('deletes old row and inserts updated row', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: RevokeApiKeyDto = {
        id: 'key-test-001',
        revoked_by: 'admin-user',
      };

      await service.revoke(dto);

      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining("DELETE WHERE id = 'key-test-001'"),
      );
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.any(Array),
      );
    });

    it('preserves all other fields when revoking', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: RevokeApiKeyDto = {
        id: 'key-test-001',
        revoked_by: 'admin-user',
      };

      await service.revoke(dto);

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'key-test-001',
            user_id: 'user-001',
            workspace_id: 'ws-001',
            name: 'Test API Key',
            scopes: JSON.stringify(['events.track', 'analytics.view']),
          }),
        ]),
      );
    });

    it('updates updated_at timestamp', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: RevokeApiKeyDto = {
        id: 'key-test-001',
        revoked_by: 'admin-user',
      };

      const result = await service.revoke(dto);

      expect(result.updated_at).toBeDefined();
      // Updated timestamp should be different from created timestamp
      expect(result.updated_at).not.toBe(mockApiKey.created_at);
    });

    it('can revoke already revoked key', async () => {
      const revokedKey = {
        ...mockApiKeyRow,
        status: 'revoked',
        revoked_by: 'user-001',
        revoked_at: '2025-01-01 12:00:00',
      };

      clickhouse.querySystem.mockResolvedValue([revokedKey]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: RevokeApiKeyDto = {
        id: 'key-test-001',
        revoked_by: 'admin-user',
      };

      const result = await service.revoke(dto);

      // Should update the revoked_by and revoked_at to new values
      expect(result.status).toBe('revoked');
      expect(result.revoked_by).toBe('admin-user');
    });

    it('excludes key_hash from returned object', async () => {
      clickhouse.querySystem.mockResolvedValue([mockApiKeyRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: RevokeApiKeyDto = {
        id: 'key-test-001',
        revoked_by: 'admin-user',
      };

      const result = await service.revoke(dto);

      expect(result).not.toHaveProperty('key_hash');
    });
  });
});
