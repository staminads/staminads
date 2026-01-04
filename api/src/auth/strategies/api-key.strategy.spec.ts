import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyStrategy, ApiKeyPayload } from './api-key.strategy';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { ApiKey } from '../../common/entities/api-key.entity';

describe('ApiKeyStrategy', () => {
  let strategy: ApiKeyStrategy;
  let apiKeysService: jest.Mocked<ApiKeysService>;

  const mockApiKey: ApiKey = {
    id: 'key-001',
    key_hash: 'hash123',
    key_prefix: 'sk_live_abc',
    user_id: 'user-001',
    workspace_id: 'ws-001',
    name: 'Test Key',
    description: '',
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyStrategy,
        {
          provide: ApiKeysService,
          useValue: {
            findByToken: jest.fn(),
            updateLastUsed: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get<ApiKeyStrategy>(ApiKeyStrategy);
    apiKeysService = module.get(ApiKeysService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('returns payload for valid active API key', async () => {
      apiKeysService.findByToken.mockResolvedValue(mockApiKey);
      apiKeysService.updateLastUsed.mockResolvedValue(undefined);

      const result = await strategy.validate(
        'stam_test_0000000000000000000000000000000000000000000000000000000000000000',
      );

      expect(result).toEqual<ApiKeyPayload>({
        type: 'api-key',
        keyId: 'key-001',
        workspaceId: 'ws-001',
        scopes: ['events.track', 'analytics.view'],
      });
    });

    it('updates last_used_at asynchronously', async () => {
      apiKeysService.findByToken.mockResolvedValue(mockApiKey);
      apiKeysService.updateLastUsed.mockResolvedValue(undefined);

      await strategy.validate('sk_live_test123');

      expect(apiKeysService.updateLastUsed).toHaveBeenCalledWith('key-001');
    });

    it('throws UnauthorizedException for invalid token format', async () => {
      await expect(strategy.validate('invalid_token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate('invalid_token')).rejects.toThrow(
        'Invalid API key format',
      );
    });

    it('throws UnauthorizedException for Bearer prefix without sk_live_', async () => {
      await expect(strategy.validate('api_key_123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when API key not found', async () => {
      apiKeysService.findByToken.mockResolvedValue(null);

      await expect(strategy.validate('sk_live_nonexistent')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate('sk_live_nonexistent')).rejects.toThrow(
        'Invalid API key',
      );
    });

    it('throws UnauthorizedException for revoked API key', async () => {
      apiKeysService.findByToken.mockResolvedValue({
        ...mockApiKey,
        status: 'revoked',
      });

      await expect(strategy.validate('sk_live_revoked')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate('sk_live_revoked')).rejects.toThrow(
        'API key is revoked',
      );
    });

    it('throws UnauthorizedException for expired API key status', async () => {
      apiKeysService.findByToken.mockResolvedValue({
        ...mockApiKey,
        status: 'expired',
      });

      await expect(strategy.validate('sk_live_expired')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate('sk_live_expired')).rejects.toThrow(
        'API key is expired',
      );
    });

    it('throws UnauthorizedException for API key past expiry date', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      apiKeysService.findByToken.mockResolvedValue({
        ...mockApiKey,
        expires_at: pastDate.toISOString(),
      });

      await expect(
        strategy.validate('sk_live_expired_date'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        strategy.validate('sk_live_expired_date'),
      ).rejects.toThrow('API key has expired');
    });

    it('allows API key with future expiry date', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      apiKeysService.findByToken.mockResolvedValue({
        ...mockApiKey,
        expires_at: futureDate.toISOString(),
      });
      apiKeysService.updateLastUsed.mockResolvedValue(undefined);

      const result = await strategy.validate('sk_live_valid_future');

      expect(result.keyId).toBe('key-001');
    });

    it('throws UnauthorizedException for API key without workspace binding', async () => {
      apiKeysService.findByToken.mockResolvedValue({
        ...mockApiKey,
        workspace_id: null,
      });

      await expect(
        strategy.validate('sk_live_no_workspace'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        strategy.validate('sk_live_no_workspace'),
      ).rejects.toThrow('API key not bound to workspace');
    });

    it('does not fail if updateLastUsed throws', async () => {
      apiKeysService.findByToken.mockResolvedValue(mockApiKey);
      apiKeysService.updateLastUsed.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw - updateLastUsed errors are caught
      const result = await strategy.validate('sk_live_test');

      expect(result.keyId).toBe('key-001');
    });
  });
});
