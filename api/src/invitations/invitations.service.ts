import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { generateId, generateToken, hashToken } from '../common/crypto';
import {
  Invitation,
  InvitationWithInviter,
  WorkspaceMembership,
} from '../common/entities';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import {
  AcceptInvitationDto,
  InvitationDetailsDto,
} from './dto/accept-invitation.dto';
import {
  toClickHouseDateTime,
  parseClickHouseDateTime,
} from '../common/utils/datetime.util';

const INVITATION_EXPIRY_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly workspacesService: WorkspacesService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * List all invitations for a workspace
   */
  async list(workspaceId: string): Promise<InvitationWithInviter[]> {
    const result = await this.clickhouse.querySystem<Invitation>(
      `
      SELECT * FROM invitations FINAL
      WHERE workspace_id = {workspaceId:String}
        AND status = 'pending'
        AND expires_at > now()
      ORDER BY created_at DESC
    `,
      { workspaceId },
    );

    // Fetch inviter info
    const invitations: InvitationWithInviter[] = [];
    for (const inv of result) {
      const inviter = await this.usersService.findById(inv.invited_by);
      invitations.push({
        ...inv,
        inviter: {
          id: inviter?.id || '',
          name: inviter?.name || 'Unknown',
          email: inviter?.email || '',
        },
      });
    }

    return invitations;
  }

  /**
   * Create and send an invitation
   */
  async create(
    dto: CreateInvitationDto,
    invitedBy: string,
  ): Promise<Invitation> {
    const email = dto.email.toLowerCase();
    const workspace = await this.workspacesService.get(dto.workspace_id);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Check if already a member
    const existingMembership = await this.getMembership(
      dto.workspace_id,
      email,
    );
    if (existingMembership) {
      throw new ConflictException('User is already a member of this workspace');
    }

    // Check for pending invitation
    const existingInvitation = await this.findPendingByEmail(
      dto.workspace_id,
      email,
    );
    if (existingInvitation) {
      throw new ConflictException(
        'Invitation already pending for this email. Use resend to send again.',
      );
    }

    const id = generateId();
    const { token, hash } = generateToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const invitation: Invitation = {
      id,
      workspace_id: dto.workspace_id,
      email,
      role: dto.role,
      token_hash: hash,
      invited_by: invitedBy,
      status: 'pending',
      expires_at: toClickHouseDateTime(expiresAt),
      accepted_at: null,
      revoked_at: null,
      revoked_by: null,
      created_at: toClickHouseDateTime(now),
      updated_at: toClickHouseDateTime(now),
    };

    await this.clickhouse.insertSystem('invitations', [invitation]);

    // Send invitation email
    const inviter = await this.usersService.findById(invitedBy);
    const baseUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:5173',
    );

    await this.mailService.sendInvitation(dto.workspace_id, email, {
      inviterName: inviter?.name || 'A team member',
      workspaceName: workspace.name,
      role: dto.role,
      inviteUrl: `${baseUrl}/invite/${token}`,
      workspaceWebsite: workspace.website,
    });

    return invitation;
  }

  /**
   * Resend an existing invitation
   */
  async resend(invitationId: string, invitedBy: string): Promise<void> {
    const invitation = await this.findById(invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Can only resend pending invitations');
    }

    // Generate new token
    const { token, hash } = generateToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.clickhouse.insertSystem('invitations', [
      {
        ...invitation,
        token_hash: hash,
        expires_at: toClickHouseDateTime(expiresAt),
        updated_at: toClickHouseDateTime(now),
      },
    ]);

    // Send email
    const workspace = await this.workspacesService.get(invitation.workspace_id);
    const inviter = await this.usersService.findById(invitedBy);
    const baseUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:5173',
    );

    await this.mailService.sendInvitation(
      invitation.workspace_id,
      invitation.email,
      {
        inviterName: inviter?.name || 'A team member',
        workspaceName: workspace.name,
        role: invitation.role,
        inviteUrl: `${baseUrl}/invite/${token}`,
        workspaceWebsite: workspace.website,
      },
    );
  }

  /**
   * Revoke a pending invitation
   */
  async revoke(invitationId: string, revokedBy: string): Promise<void> {
    const invitation = await this.findById(invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Can only revoke pending invitations');
    }

    const now = toClickHouseDateTime();

    await this.clickhouse.insertSystem('invitations', [
      {
        ...invitation,
        status: 'revoked',
        revoked_at: now,
        revoked_by: revokedBy,
        updated_at: now,
      },
    ]);
  }

  /**
   * Get invitation details by token (public endpoint)
   */
  async getByToken(token: string): Promise<InvitationDetailsDto | null> {
    const tokenHash = hashToken(token);

    const result = await this.clickhouse.querySystem<Invitation>(
      `
      SELECT * FROM invitations FINAL
      WHERE token_hash = {tokenHash:String}
      LIMIT 1
    `,
      { tokenHash },
    );

    const invitation = result[0];
    if (!invitation) {
      return null;
    }

    // Check status
    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        invitation.status === 'accepted'
          ? 'This invitation has already been accepted'
          : 'This invitation is no longer valid',
      );
    }

    // Check expiry
    const expiresAt = parseClickHouseDateTime(invitation.expires_at);
    if (expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    const workspace = await this.workspacesService.get(invitation.workspace_id);
    const inviter = await this.usersService.findById(invitation.invited_by);
    const existingUser = await this.usersService.findByEmail(invitation.email);

    return {
      id: invitation.id,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        website: workspace.website,
        logo_url: workspace.logo_url,
      },
      email: invitation.email,
      role: invitation.role,
      inviter: {
        name: inviter?.name || 'Unknown',
      },
      existingUser: !!existingUser,
      expiresAt: invitation.expires_at,
    };
  }

  /**
   * Accept an invitation
   */
  async accept(
    dto: AcceptInvitationDto,
    currentUserId?: string,
  ): Promise<{
    userId: string;
    workspaceId: string;
  }> {
    const tokenHash = hashToken(dto.token);

    const result = await this.clickhouse.querySystem<Invitation>(
      `
      SELECT * FROM invitations FINAL
      WHERE token_hash = {tokenHash:String}
      LIMIT 1
    `,
      { tokenHash },
    );

    const invitation = result[0];
    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }

    // Validate invitation
    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        invitation.status === 'accepted'
          ? 'This invitation has already been accepted'
          : 'This invitation is no longer valid',
      );
    }

    const expiresAt = parseClickHouseDateTime(invitation.expires_at);
    if (expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    // Check for existing user
    const existingUser = await this.usersService.findByEmail(invitation.email);
    let userId: string;

    if (existingUser) {
      // Existing user flow
      if (currentUserId && currentUserId !== existingUser.id) {
        throw new ForbiddenException(
          'This invitation is for a different email address',
        );
      }
      userId = existingUser.id;
    } else {
      // New user flow - must provide name and password
      if (!dto.name || !dto.password) {
        throw new BadRequestException(
          'Name and password are required for new users',
        );
      }

      const newUser = await this.usersService.create({
        email: invitation.email,
        name: dto.name,
        password: dto.password,
      });
      userId = newUser.id;
    }

    // Create membership
    const now = toClickHouseDateTime();
    const membershipId = generateId();

    await this.clickhouse.insertSystem('workspace_memberships', [
      {
        id: membershipId,
        workspace_id: invitation.workspace_id,
        user_id: userId,
        role: invitation.role,
        invited_by: invitation.invited_by,
        joined_at: now,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Mark invitation as accepted
    await this.clickhouse.insertSystem('invitations', [
      {
        ...invitation,
        status: 'accepted',
        accepted_at: now,
        updated_at: now,
      },
    ]);

    // Send welcome email
    const workspace = await this.workspacesService.get(invitation.workspace_id);
    const user = await this.usersService.findById(userId);
    const baseUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:5173',
    );

    await this.mailService.sendWelcome(
      invitation.workspace_id,
      invitation.email,
      {
        userName: user!.name,
        workspaceName: workspace.name,
        role: invitation.role,
        dashboardUrl: `${baseUrl}/workspaces/${invitation.workspace_id}`,
      },
    );

    return {
      userId,
      workspaceId: invitation.workspace_id,
    };
  }

  private async findById(id: string): Promise<Invitation | null> {
    const result = await this.clickhouse.querySystem<Invitation>(
      `
      SELECT * FROM invitations FINAL
      WHERE id = {id:String}
      LIMIT 1
    `,
      { id },
    );

    return result[0] || null;
  }

  private async findPendingByEmail(
    workspaceId: string,
    email: string,
  ): Promise<Invitation | null> {
    const result = await this.clickhouse.querySystem<Invitation>(
      `
      SELECT * FROM invitations FINAL
      WHERE workspace_id = {workspaceId:String}
        AND email = {email:String}
        AND status = 'pending'
        AND expires_at > now()
      LIMIT 1
    `,
      { workspaceId, email },
    );

    return result[0] || null;
  }

  private async getMembership(
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceMembership | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const result = await this.clickhouse.querySystem<WorkspaceMembership>(
      `
      SELECT * FROM workspace_memberships FINAL
      WHERE workspace_id = {workspaceId:String}
        AND user_id = {userId:String}
      LIMIT 1
    `,
      { workspaceId, userId: user.id },
    );

    return result[0] || null;
  }
}
