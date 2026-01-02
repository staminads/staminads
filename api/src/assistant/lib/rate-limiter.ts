import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AnthropicIntegration,
  IntegrationUsage,
} from '../../workspaces/entities/integration.entity';

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
export function checkRateLimits(integration: AnthropicIntegration): void {
  const now = new Date();
  const lastReset = new Date(integration.usage.last_reset);

  // Check hourly request limit
  const hoursSinceReset =
    (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

  if (hoursSinceReset < 1) {
    if (
      integration.usage.requests_this_hour >=
      integration.limits.max_requests_per_hour
    ) {
      const secondsUntilReset = Math.ceil((1 - hoursSinceReset) * 3600);
      throw new RateLimitException(
        `Rate limit exceeded. Try again in ${secondsUntilReset} seconds.`,
        secondsUntilReset,
      );
    }
  }

  // Check daily token limit
  const daysSinceReset = hoursSinceReset / 24;
  if (daysSinceReset < 1) {
    if (
      integration.usage.tokens_today >= integration.limits.max_tokens_per_day
    ) {
      throw new RateLimitException(
        'Daily token limit exceeded. Try again tomorrow.',
      );
    }
  }
}

/**
 * Update usage after a successful request.
 */
export function updateUsage(
  usage: IntegrationUsage,
  tokensUsed: number,
): IntegrationUsage {
  const now = new Date();
  const lastReset = new Date(usage.last_reset);
  const hoursSinceReset =
    (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

  // Reset counters if enough time has passed
  if (hoursSinceReset >= 24) {
    // Reset both hourly and daily counters
    return {
      requests_this_hour: 1,
      tokens_today: tokensUsed,
      last_reset: now.toISOString(),
    };
  } else if (hoursSinceReset >= 1) {
    // Reset only hourly counter
    return {
      requests_this_hour: 1,
      tokens_today: usage.tokens_today + tokensUsed,
      last_reset: now.toISOString(),
    };
  }

  // Increment counters
  return {
    requests_this_hour: usage.requests_this_hour + 1,
    tokens_today: usage.tokens_today + tokensUsed,
    last_reset: usage.last_reset,
  };
}

/**
 * Check if usage counters should be reset.
 */
export function shouldResetUsage(usage: IntegrationUsage): {
  resetHourly: boolean;
  resetDaily: boolean;
} {
  const now = new Date();
  const lastReset = new Date(usage.last_reset);
  const hoursSinceReset =
    (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

  return {
    resetHourly: hoursSinceReset >= 1,
    resetDaily: hoursSinceReset >= 24,
  };
}
