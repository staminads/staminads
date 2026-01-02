import {
  checkRateLimits,
  updateUsage,
  getCurrentUsage,
  RateLimitException,
} from './rate-limiter';
import { AnthropicIntegration } from '../../workspaces/entities/integration.entity';

describe('rate-limiter', () => {
  const createIntegration = (
    id: string,
    limits = { max_requests_per_hour: 60, max_tokens_per_day: 100000 },
  ): AnthropicIntegration => ({
    id,
    type: 'anthropic',
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    settings: {
      api_key_encrypted: 'encrypted-key',
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      temperature: 0.7,
    },
    limits,
  });

  describe('checkRateLimits', () => {
    it('does not throw when under limits', () => {
      const integration = createIntegration('test-1');
      expect(() => checkRateLimits('ws-1', integration)).not.toThrow();
    });

    it('throws RateLimitException when hourly request limit exceeded', () => {
      const integration = createIntegration('test-2', {
        max_requests_per_hour: 2,
        max_tokens_per_day: 100000,
      });

      // Use up all requests
      updateUsage('ws-2', integration.id, 100);
      updateUsage('ws-2', integration.id, 100);

      expect(() => checkRateLimits('ws-2', integration)).toThrow(
        RateLimitException,
      );
      expect(() => checkRateLimits('ws-2', integration)).toThrow(
        /Rate limit exceeded/,
      );
    });

    it('throws RateLimitException when daily token limit exceeded', () => {
      const integration = createIntegration('test-3', {
        max_requests_per_hour: 1000,
        max_tokens_per_day: 500,
      });

      // Use up all tokens
      updateUsage('ws-3', integration.id, 600);

      expect(() => checkRateLimits('ws-3', integration)).toThrow(
        RateLimitException,
      );
      expect(() => checkRateLimits('ws-3', integration)).toThrow(
        /Daily token limit exceeded/,
      );
    });

    it('includes retry_after in hourly limit exception', () => {
      const integration = createIntegration('test-4', {
        max_requests_per_hour: 1,
        max_tokens_per_day: 100000,
      });

      updateUsage('ws-4', integration.id, 100);

      try {
        checkRateLimits('ws-4', integration);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitException);
        const response = (error as RateLimitException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.retry_after).toBeDefined();
        expect(typeof response.retry_after).toBe('number');
      }
    });
  });

  describe('updateUsage', () => {
    it('increments request count and token usage', () => {
      const integrationId = 'test-5';
      const workspaceId = 'ws-5';

      // Get initial usage (should be 0)
      const initial = getCurrentUsage(workspaceId, integrationId);
      expect(initial.requests_this_hour).toBe(0);
      expect(initial.tokens_today).toBe(0);

      // Update usage
      updateUsage(workspaceId, integrationId, 500);

      const after = getCurrentUsage(workspaceId, integrationId);
      expect(after.requests_this_hour).toBe(1);
      expect(after.tokens_today).toBe(500);
    });

    it('accumulates multiple updates', () => {
      const integrationId = 'test-6';
      const workspaceId = 'ws-6';

      updateUsage(workspaceId, integrationId, 100);
      updateUsage(workspaceId, integrationId, 200);
      updateUsage(workspaceId, integrationId, 300);

      const usage = getCurrentUsage(workspaceId, integrationId);
      expect(usage.requests_this_hour).toBe(3);
      expect(usage.tokens_today).toBe(600);
    });
  });

  describe('getCurrentUsage', () => {
    it('returns zero for new integration', () => {
      const usage = getCurrentUsage('new-ws', 'new-integration');
      expect(usage.requests_this_hour).toBe(0);
      expect(usage.tokens_today).toBe(0);
    });

    it('tracks separate usage per workspace-integration pair', () => {
      updateUsage('ws-a', 'int-1', 100);
      updateUsage('ws-b', 'int-1', 200);

      const usageA = getCurrentUsage('ws-a', 'int-1');
      const usageB = getCurrentUsage('ws-b', 'int-1');

      expect(usageA.tokens_today).toBe(100);
      expect(usageB.tokens_today).toBe(200);
    });
  });

  describe('RateLimitException', () => {
    it('has correct status code', () => {
      const exception = new RateLimitException('Test message');
      expect(exception.getStatus()).toBe(429);
    });

    it('includes message in response', () => {
      const exception = new RateLimitException('Custom message');
      const response = exception.getResponse() as Record<string, unknown>;
      expect(response.message).toBe('Custom message');
    });

    it('includes retry_after when provided', () => {
      const exception = new RateLimitException('Test', 3600);
      const response = exception.getResponse() as Record<string, unknown>;
      expect(response.retry_after).toBe(3600);
    });
  });
});
