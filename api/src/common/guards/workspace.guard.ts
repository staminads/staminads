import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ApiKeyPayload } from '../../auth/strategies/api-key.strategy';

/**
 * Guard that validates the workspace_id in the request body
 * matches the workspace bound to the API key.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as ApiKeyPayload;
    const body = request.body;

    if (!user || user.type !== 'api-key') {
      return true; // Let other guards handle non-API-key auth
    }

    // Check workspace_id in body matches API key's workspace
    const workspaceId = body?.workspace_id;

    if (workspaceId && workspaceId !== user.workspaceId) {
      throw new ForbiddenException(
        'API key not authorized for this workspace',
      );
    }

    return true;
  }
}
