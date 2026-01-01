import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Header priority order for extracting client IP.
 * Ordered by common CDN/proxy usage.
 */
const IP_HEADER_ORDER = [
  'cf-connecting-ip', // Cloudflare
  'x-real-ip', // Nginx proxy
  'x-forwarded-for', // Standard proxy header
  'true-client-ip', // Akamai, Cloudflare Enterprise
  'x-client-ip', // General proxy
  'x-cluster-client-ip', // Rackspace
  'fastly-client-ip', // Fastly CDN
  'x-vercel-forwarded-for', // Vercel
  'do-connecting-ip', // DigitalOcean
];

/**
 * Basic IP validation (IPv4 and IPv6)
 */
function isValidIp(ip: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;

  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  // IPv4-mapped IPv6
  const ipv4MappedPattern = /^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i;

  return (
    ipv4Pattern.test(ip) || ipv6Pattern.test(ip) || ipv4MappedPattern.test(ip)
  );
}

/**
 * Normalize IP address format
 */
function normalizeIp(ip: string): string {
  // Convert IPv4-mapped IPv6 to IPv4
  if (ip.toLowerCase().startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Extract the real client IP address from request headers.
 * Handles various proxy and CDN configurations.
 *
 * @returns The client IP address or null if not found
 */
function getClientIp(req: Request): string | null {
  // Check configured headers in priority order
  for (const header of IP_HEADER_ORDER) {
    const value = req.headers[header];

    if (value) {
      const ip = typeof value === 'string' ? value : value[0];

      // x-forwarded-for contains comma-separated list; take the first (original client)
      const clientIp = ip?.split(',')[0]?.trim();

      if (clientIp && isValidIp(clientIp)) {
        return normalizeIp(clientIp);
      }
    }
  }

  // Fallback to socket address
  const socketIp = req.socket?.remoteAddress;
  if (socketIp && isValidIp(socketIp)) {
    return normalizeIp(socketIp);
  }

  return null;
}

/**
 * Parameter decorator that extracts the client IP address from the request.
 *
 * @example
 * ```typescript
 * @Post('track')
 * async track(@Body() dto: TrackEventDto, @ClientIp() clientIp: string | null) {
 *   // clientIp is the real client IP, or null if not determinable
 * }
 * ```
 */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return getClientIp(request);
  },
);
