import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiSecurity, ApiHeader } from '@nestjs/swagger';
import { ApiScope } from '../entities/api-key.entity';

export const REQUIRED_SCOPES_KEY = 'requiredScopes';
export const IS_API_KEY_ROUTE = 'isApiKeyRoute';

/**
 * Decorator to mark an endpoint as requiring specific API key scopes.
 * Use with @UseGuards(AuthGuard('api-key'), ScopeGuard) on the endpoint.
 *
 * This decorator also marks the route as an API key route, which tells
 * the global JwtAuthGuard to skip JWT validation for this endpoint.
 *
 * @example
 * @RequireScope('events.track')
 * @UseGuards(AuthGuard('api-key'), ScopeGuard)
 * async track(@Body() dto: TrackEventDto) { ... }
 */
export function RequireScope(...scopes: ApiScope[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_SCOPES_KEY, scopes),
    SetMetadata(IS_API_KEY_ROUTE, true),
    ApiSecurity('api-key'),
    ApiHeader({
      name: 'Authorization',
      description: 'Bearer sk_live_...',
      required: true,
    }),
  );
}
