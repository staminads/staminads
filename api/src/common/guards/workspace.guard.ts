import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyPayload } from '../../auth/strategies/api-key.strategy';
import { MembersService } from '../../members/members.service';
import { hasPermission, Permission } from '../permissions';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * Unified guard that validates workspace access for both API keys and JWT users.
 *
 * For API keys: validates the workspace_id in the request matches the API key's bound workspace.
 * For JWT users: validates the user is a member of the workspace.
 *
 * Optionally checks permissions when @RequirePermission() decorator is present.
 */
@Injectable()
export class WorkspaceAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(forwardRef(() => MembersService))
    private membersService: MembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Extract workspace_id from various locations:
    // - First check body (for POST/PUT/DELETE)
    // - Then check query params (for GET, or POST with query params like filters.delete)
    // - Also check for 'id' field in workspaces controller context
    // - Support both snake_case (workspace_id) and camelCase (workspaceId)
    const workspaceId =
      request.body?.workspace_id ||
      request.body?.workspaceId ||
      request.body?.id ||
      request.query?.workspace_id ||
      request.query?.workspaceId ||
      request.query?.id;

    if (!workspaceId) {
      throw new BadRequestException('workspace_id is required');
    }

    // API Key auth: validate workspace binding and permissions
    if (user?.type === 'api-key') {
      const apiKeyUser = user as ApiKeyPayload;
      if (workspaceId !== apiKeyUser.workspaceId) {
        throw new ForbiddenException(
          'API key not authorized for this workspace',
        );
      }

      // Check permission if @RequirePermission() decorator is present
      const requiredPermission = this.reflector.getAllAndOverride<Permission>(
        REQUIRED_PERMISSION_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (
        requiredPermission &&
        !hasPermission(apiKeyUser.role, requiredPermission)
      ) {
        throw new ForbiddenException('API key has insufficient permissions');
      }

      return true;
    }

    // Super admins can access any workspace
    if (user.isSuperAdmin) {
      // Create synthetic owner membership for permission checks
      request.membership = {
        id: 'super-admin',
        workspace_id: workspaceId,
        user_id: user.id,
        role: 'owner',
        invited_by: null,
        joined_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return true;
    }

    // JWT auth: validate membership
    const membership = await this.membersService.getMembership(
      workspaceId,
      user.id,
    );
    if (!membership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    // Attach membership to request for use in controllers
    request.membership = membership;

    // Check permission if @RequirePermission() decorator is present
    const requiredPermission = this.reflector.getAllAndOverride<Permission>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      requiredPermission &&
      !hasPermission(membership.role, requiredPermission)
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

// Keep old name as alias for backwards compatibility with Events controller
export { WorkspaceAuthGuard as WorkspaceGuard };
