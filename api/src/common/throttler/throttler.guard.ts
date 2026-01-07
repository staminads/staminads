import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';
import { getClientIp } from '../utils/ip.util';

/**
 * Custom throttler guard that uses proper IP extraction for proxied requests.
 * Handles CDN and proxy headers (Cloudflare, Nginx, Vercel, etc.)
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /**
   * Skip throttling in test mode or when @SkipThrottle() is applied.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip in test mode
    const isTest =
      process.env.NODE_ENV === 'test' ||
      process.env.CLICKHOUSE_SYSTEM_DATABASE?.includes('test');
    if (isTest) {
      return true;
    }

    // Let parent class handle @SkipThrottle() and rate limiting
    return super.canActivate(context);
  }

  /**
   * Extract tracker key (client IP) for rate limiting.
   * Uses the shared IP utility for consistent behavior with @ClientIp decorator.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getTracker(req: Request): Promise<string> {
    const ip = getClientIp(req);
    return ip || req.socket?.remoteAddress || 'unknown';
  }

  /**
   * Custom error message for rate limit exceeded.
   */
  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  protected async throwThrottlingException(
    _context: ExecutionContext,
  ): Promise<void> {
    throw new ThrottlerException('Too many requests. Please try again later.');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
}
