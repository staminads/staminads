import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import {
  WorkspaceMembership,
  MemberWithUser,
  Role,
} from '../common/entities/membership.entity';
import {
  hasPermission,
  canModifyMember,
  ROLE_HIERARCHY,
} from '../common/permissions';
import { generateId } from '../common/crypto';
import { ListMembersDto } from './dto/list-members.dto';
import { GetMemberDto } from './dto/get-member.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RemoveMemberDto } from './dto/remove-member.dto';
import { LeaveWorkspaceDto } from './dto/leave-workspace.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { toClickHouseDateTime } from '../common/utils/datetime.util';

interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

function parseMembership(row: MembershipRow): WorkspaceMembership {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    role: row.role,
    invited_by: row.invited_by,
    joined_at: row.joined_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class MembersService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  /**
   * Get a membership by workspace and user ID
   */
  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership | null> {
    const rows = await this.clickhouse.querySystem<MembershipRow>(
      `SELECT * FROM workspace_memberships FINAL
       WHERE workspace_id = {workspace_id:String}
         AND user_id = {user_id:String}
       LIMIT 1`,
      { workspace_id: workspaceId, user_id: userId },
    );

    return rows.length > 0 ? parseMembership(rows[0]) : null;
  }

  /**
   * List all members of a workspace with user details
   */
  async list(dto: ListMembersDto, actorId: string): Promise<MemberWithUser[]> {
    // Verify actor has permission to view members
    const actorMembership = await this.getMembership(dto.workspace_id, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    // Get all memberships for the workspace
    const rows = await this.clickhouse.querySystem<MembershipRow>(
      `SELECT * FROM workspace_memberships FINAL
       WHERE workspace_id = {workspace_id:String}
       ORDER BY created_at ASC`,
      { workspace_id: dto.workspace_id },
    );

    // Fetch user details for each membership
    const membersWithUsers: MemberWithUser[] = [];
    for (const row of rows) {
      const user = await this.usersService.findById(row.user_id);
      if (user) {
        membersWithUsers.push({
          ...parseMembership(row),
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            status: user.status,
          },
        });
      }
    }

    return membersWithUsers;
  }

  /**
   * Get a specific member with user details
   */
  async get(dto: GetMemberDto, actorId: string): Promise<MemberWithUser> {
    // Verify actor has permission to view members
    const actorMembership = await this.getMembership(dto.workspace_id, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    const membership = await this.getMembership(dto.workspace_id, dto.user_id);
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    const user = await this.usersService.findById(dto.user_id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...membership,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      },
    };
  }

  /**
   * Update a member's role
   */
  async updateRole(
    dto: UpdateRoleDto,
    actorId: string,
  ): Promise<MemberWithUser> {
    // Get actor's membership and verify permissions
    const actorMembership = await this.getMembership(dto.workspace_id, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    if (!hasPermission(actorMembership.role, 'members.manage')) {
      throw new ForbiddenException(
        'Insufficient permissions to manage members',
      );
    }

    // Get target membership
    const targetMembership = await this.getMembership(
      dto.workspace_id,
      dto.user_id,
    );
    if (!targetMembership) {
      throw new NotFoundException('Member not found');
    }

    // Cannot modify yourself
    if (actorId === dto.user_id) {
      throw new BadRequestException('Cannot modify your own role');
    }

    // Check role hierarchy - can only modify members with lower role
    if (!canModifyMember(actorMembership.role, targetMembership.role)) {
      throw new ForbiddenException(
        'Cannot modify a member with equal or higher role',
      );
    }

    // Only owners can promote to owner role
    if (dto.role === 'owner' && actorMembership.role !== 'owner') {
      throw new ForbiddenException('Only owners can promote members to owner');
    }

    // Cannot promote someone to a role higher than your own (but owners can promote to owner)
    if (
      ROLE_HIERARCHY[dto.role] > ROLE_HIERARCHY[actorMembership.role] ||
      (dto.role !== 'owner' &&
        ROLE_HIERARCHY[dto.role] >= ROLE_HIERARCHY[actorMembership.role])
    ) {
      throw new ForbiddenException(
        'Cannot promote a member to your role or higher',
      );
    }

    // Update the membership
    const now = toClickHouseDateTime();
    const updated: WorkspaceMembership = {
      ...targetMembership,
      role: dto.role,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('workspace_memberships', [updated]);

    // Log audit event
    await this.auditService.log({
      user_id: actorId,
      workspace_id: dto.workspace_id,
      action: 'member.role_updated',
      target_type: 'membership',
      target_id: targetMembership.id,
      metadata: {
        user_id: dto.user_id,
        old_role: targetMembership.role,
        new_role: dto.role,
      },
    });

    // Fetch user details for response
    const user = await this.usersService.findById(dto.user_id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...updated,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      },
    };
  }

  /**
   * Remove a member from a workspace
   */
  async remove(dto: RemoveMemberDto, actorId: string): Promise<void> {
    // Get actor's membership and verify permissions
    const actorMembership = await this.getMembership(dto.workspace_id, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    if (!hasPermission(actorMembership.role, 'members.remove')) {
      throw new ForbiddenException(
        'Insufficient permissions to remove members',
      );
    }

    // Get target membership
    const targetMembership = await this.getMembership(
      dto.workspace_id,
      dto.user_id,
    );
    if (!targetMembership) {
      throw new NotFoundException('Member not found');
    }

    // Cannot remove yourself - use leave endpoint instead
    if (actorId === dto.user_id) {
      throw new BadRequestException(
        'Cannot remove yourself. Use the leave endpoint instead',
      );
    }

    // Only owners can remove other owners
    if (targetMembership.role === 'owner' && actorMembership.role !== 'owner') {
      throw new ForbiddenException('Only owners can remove other owners');
    }

    // Prevent removing the last owner - workspace must always have at least one owner
    if (targetMembership.role === 'owner') {
      const ownerCount = await this.countOwners(dto.workspace_id);
      if (ownerCount <= 1) {
        throw new ForbiddenException(
          'Cannot remove the last owner. Transfer ownership first',
        );
      }
    }

    // Check role hierarchy for non-owner targets - can only remove members with lower role
    if (
      targetMembership.role !== 'owner' &&
      !canModifyMember(actorMembership.role, targetMembership.role)
    ) {
      throw new ForbiddenException(
        'Cannot remove a member with equal or higher role',
      );
    }

    // Delete the membership
    await this.clickhouse.commandSystem(
      `ALTER TABLE workspace_memberships DELETE WHERE id = '${targetMembership.id}'`,
    );

    // Revoke all sessions for the removed user to force immediate logout
    await this.authService.revokeAllSessions(dto.user_id);

    // Log audit event
    await this.auditService.log({
      user_id: actorId,
      workspace_id: dto.workspace_id,
      action: 'member.removed',
      target_type: 'membership',
      target_id: targetMembership.id,
      metadata: {
        user_id: dto.user_id,
        role: targetMembership.role,
        sessions_revoked: true,
      },
    });
  }

  /**
   * Leave a workspace voluntarily
   */
  async leave(dto: LeaveWorkspaceDto, userId: string): Promise<void> {
    // Get user's membership
    const membership = await this.getMembership(dto.workspace_id, userId);
    if (!membership) {
      throw new NotFoundException('Not a member of this workspace');
    }

    // Check if user is the last owner
    if (membership.role === 'owner') {
      const ownerCount = await this.countOwners(dto.workspace_id);
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Cannot leave as the last owner. Transfer ownership first',
        );
      }
    }

    // Delete the membership
    await this.clickhouse.commandSystem(
      `ALTER TABLE workspace_memberships DELETE WHERE id = '${membership.id}'`,
    );

    // Log audit event
    await this.auditService.log({
      user_id: userId,
      workspace_id: dto.workspace_id,
      action: 'member.left',
      target_type: 'membership',
      target_id: membership.id,
      metadata: {
        role: membership.role,
      },
    });
  }

  /**
   * Transfer ownership to another member
   */
  async transferOwnership(
    dto: TransferOwnershipDto,
    actorId: string,
  ): Promise<{ old_owner: MemberWithUser; new_owner: MemberWithUser }> {
    // Get actor's membership and verify they are an owner
    const actorMembership = await this.getMembership(dto.workspace_id, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    if (actorMembership.role !== 'owner') {
      throw new ForbiddenException('Only owners can transfer ownership');
    }

    // Cannot transfer to yourself
    if (actorId === dto.new_owner_id) {
      throw new BadRequestException('Cannot transfer ownership to yourself');
    }

    // Get new owner's membership
    const newOwnerMembership = await this.getMembership(
      dto.workspace_id,
      dto.new_owner_id,
    );
    if (!newOwnerMembership) {
      throw new NotFoundException(
        'New owner is not a member of this workspace',
      );
    }

    const now = toClickHouseDateTime();

    // Demote current owner to admin
    const demotedOwner: WorkspaceMembership = {
      ...actorMembership,
      role: 'admin',
      updated_at: now,
    };

    // Promote new owner
    const promotedOwner: WorkspaceMembership = {
      ...newOwnerMembership,
      role: 'owner',
      updated_at: now,
    };

    // Update both memberships
    await this.clickhouse.insertSystem('workspace_memberships', [
      demotedOwner,
      promotedOwner,
    ]);

    // Log audit event
    await this.auditService.log({
      user_id: actorId,
      workspace_id: dto.workspace_id,
      action: 'ownership.transferred',
      target_type: 'workspace',
      target_id: dto.workspace_id,
      metadata: {
        old_owner_id: actorId,
        new_owner_id: dto.new_owner_id,
      },
    });

    // Fetch user details for response
    const oldOwnerUser = await this.usersService.findById(actorId);
    const newOwnerUser = await this.usersService.findById(dto.new_owner_id);

    if (!oldOwnerUser || !newOwnerUser) {
      throw new NotFoundException('User not found');
    }

    return {
      old_owner: {
        ...demotedOwner,
        user: {
          id: oldOwnerUser.id,
          email: oldOwnerUser.email,
          name: oldOwnerUser.name,
          status: oldOwnerUser.status,
        },
      },
      new_owner: {
        ...promotedOwner,
        user: {
          id: newOwnerUser.id,
          email: newOwnerUser.email,
          name: newOwnerUser.name,
          status: newOwnerUser.status,
        },
      },
    };
  }

  /**
   * Count the number of owners in a workspace
   */
  private async countOwners(workspaceId: string): Promise<number> {
    const rows = await this.clickhouse.querySystem<{ count: string }>(
      `SELECT count(*) as count FROM workspace_memberships FINAL
       WHERE workspace_id = {workspace_id:String}
         AND role = 'owner'`,
      { workspace_id: workspaceId },
    );

    return rows.length > 0 ? parseInt(rows[0].count, 10) : 0;
  }
}
