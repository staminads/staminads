import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scope.decorator';
import { ApiScope } from '../entities/api-key.entity';
import { ApiKeyPayload } from '../../auth/strategies/api-key.strategy';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<ApiScope[]>(
      REQUIRED_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as ApiKeyPayload;

    if (!user || user.type !== 'api-key') {
      throw new ForbiddenException('API key required');
    }

    const hasScope = requiredScopes.some((scope) =>
      user.scopes.includes(scope),
    );

    if (!hasScope) {
      throw new ForbiddenException(
        `Missing required scope: ${requiredScopes.join(' or ')}`,
      );
    }

    return true;
  }
}
