import { SkipThrottle, Throttle } from '@nestjs/throttler';

/**
 * Stricter rate limit for auth endpoints (10 req/min)
 * Applies only the 'auth' throttler.
 */
export function AuthThrottle() {
  return Throttle({ auth: { limit: 10, ttl: 60000 } });
}

/**
 * Higher rate limit for analytics endpoints (1000 req/min)
 * Dashboard queries can be frequent when users interact with charts.
 * Combined with caching to reduce actual DB load.
 */
export function AnalyticsThrottle() {
  return Throttle({
    analytics: { limit: 1000, ttl: 60000 },
    default: { limit: 1000, ttl: 60000 }, // Override default too
  });
}

/**
 * Skip ALL rate limiting for high-volume endpoints.
 * CRITICAL: With named throttlers, must explicitly skip each by name.
 * Use this on track endpoints that may receive millions of requests from same IP.
 */
export function SkipRateLimit() {
  return SkipThrottle({ auth: true, default: true, analytics: true });
}

// Re-export for custom use cases
export { SkipThrottle, Throttle };
