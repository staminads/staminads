import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { getClientIp } from '../utils/ip.util';

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
