import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JWT_ONLY_KEY } from '../decorators/jwt-only.decorator';

/**
 * Global auth guard that accepts both JWT and API key authentication.
 *
 * - For public routes (@Public decorator), authentication is skipped
 * - For JWT-only routes (@JwtOnly decorator), API keys are rejected
 * - For protected routes, tries JWT first, then API key
 * - If both fail, returns 401 Unauthorized
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(['jwt', 'api-key']) {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = any>(
    err: any,
    user: TUser,
    info: any,
    context: ExecutionContext,
  ): TUser {
    if (user) {
      // Check if route requires JWT only
      const isJwtOnly = this.reflector.getAllAndOverride<boolean>(
        JWT_ONLY_KEY,
        [context.getHandler(), context.getClass()],
      );

      // Reject API key auth on JWT-only routes
      if (isJwtOnly && (user as any)?.type === 'api-key') {
        throw new UnauthorizedException(
          'This endpoint requires JWT authentication',
        );
      }

      return user;
    }
    if (err) {
      throw err;
    }
    throw new UnauthorizedException();
  }
}
