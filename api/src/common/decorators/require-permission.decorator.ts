import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permissions';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Decorator to require a specific permission for an endpoint.
 * Used in conjunction with WorkspaceAuthGuard to enforce role-based access control.
 *
 * @example
 * ```typescript
 * @UseGuards(WorkspaceAuthGuard)
 * @RequirePermission('workspace.delete')
 * @Post('workspaces.delete')
 * delete(@Body() dto: DeleteWorkspaceDto) {
 *   // Only users with 'workspace.delete' permission can access this
 * }
 * ```
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
