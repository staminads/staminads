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
   * Extract tracker key (client IP) for rate limiting.
   * Uses the shared IP utility for consistent behavior with @ClientIp decorator.
   */
  protected async getTracker(req: Request): Promise<string> {
    const ip = getClientIp(req);
    return ip || req.socket?.remoteAddress || 'unknown';
  }

  /**
   * Custom error message for rate limit exceeded.
   */
  protected async throwThrottlingException(
    _context: ExecutionContext,
  ): Promise<void> {
    throw new ThrottlerException('Too many requests. Please try again later.');
  }
}
