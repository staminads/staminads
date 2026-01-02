import { HttpException, HttpStatus } from '@nestjs/common';
import { AnthropicIntegration } from '../../workspaces/entities/integration.entity';

/**
 * In-memory usage tracking (not persisted).
 */
interface UsageEntry {
  requests_this_hour: number;
  tokens_today: number;
  last_reset: Date;
}

/**
 * In-memory store for usage tracking by workspace+integration ID.
 */
const usageStore = new Map<string, UsageEntry>();

/**
 * Get usage key for a workspace and integration.
 */
function getUsageKey(workspaceId: string, integrationId: string): string {
  return `${workspaceId}:${integrationId}`;
}

/**
 * Get or create usage entry for an integration.
 */
function getUsage(workspaceId: string, integrationId: string): UsageEntry {
  const key = getUsageKey(workspaceId, integrationId);
  let entry = usageStore.get(key);

  if (!entry) {
    entry = {
      requests_this_hour: 0,
      tokens_today: 0,
      last_reset: new Date(),
    };
    usageStore.set(key, entry);
  }

  return entry;
}

/**
 * Reset usage counters if enough time has passed.
 */
function maybeResetCounters(entry: UsageEntry): void {
  const now = new Date();
  const hoursSinceReset =
    (now.getTime() - entry.last_reset.getTime()) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    // Reset both hourly and daily counters
    entry.requests_this_hour = 0;
    entry.tokens_today = 0;
    entry.last_reset = now;
  } else if (hoursSinceReset >= 1) {
    // Reset only hourly counter
    entry.requests_this_hour = 0;
    entry.last_reset = now;
  }
}

/**
 * Rate limit exception with retry-after support.
 */
export class RateLimitException extends HttpException {
  constructor(message: string, retryAfter?: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        retry_after: retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Check if the integration has exceeded its rate limits.
 * Throws RateLimitException if limits are exceeded.
 */
export function checkRateLimits(
  workspaceId: string,
  integration: AnthropicIntegration,
): void {
  const entry = getUsage(workspaceId, integration.id);
  maybeResetCounters(entry);

  const limits = integration.limits;

  // Check hourly request limit
  if (entry.requests_this_hour >= limits.max_requests_per_hour) {
    const now = new Date();
    const hoursSinceReset =
      (now.getTime() - entry.last_reset.getTime()) / (1000 * 60 * 60);
    const secondsUntilReset = Math.ceil((1 - hoursSinceReset) * 3600);
    throw new RateLimitException(
      `Rate limit exceeded. Try again in ${secondsUntilReset} seconds.`,
      secondsUntilReset,
    );
  }

  // Check daily token limit
  if (entry.tokens_today >= limits.max_tokens_per_day) {
    throw new RateLimitException(
      'Daily token limit exceeded. Try again tomorrow.',
    );
  }
}

/**
 * Update usage after a successful request.
 */
export function updateUsage(
  workspaceId: string,
  integrationId: string,
  tokensUsed: number,
): void {
  const entry = getUsage(workspaceId, integrationId);
  maybeResetCounters(entry);

  entry.requests_this_hour += 1;
  entry.tokens_today += tokensUsed;
}

/**
 * Get current usage for an integration (for display purposes).
 */
export function getCurrentUsage(
  workspaceId: string,
  integrationId: string,
): { requests_this_hour: number; tokens_today: number } {
  const entry = getUsage(workspaceId, integrationId);
  maybeResetCounters(entry);

  return {
    requests_this_hour: entry.requests_this_hour,
    tokens_today: entry.tokens_today,
  };
}
