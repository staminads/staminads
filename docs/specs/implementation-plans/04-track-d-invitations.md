# Track D: Invitations Module Implementation Plan

**Track:** D - Invitations Module
**Dependencies:** Track A (Users), Track B (SMTP/Mail)
**Blocks:** None (end-user feature)

---

## Overview

The Invitations module handles sending, accepting, and managing workspace invitations. It supports both new users (who need to register) and existing users (who just confirm).

---

## Files to Create

```
api/src/invitations/
├── invitations.module.ts
├── invitations.service.ts
├── invitations.controller.ts
├── invitations.service.spec.ts
└── dto/
    ├── create-invitation.dto.ts
    └── accept-invitation.dto.ts
```

---

## Task 1: DTOs

### 1.1 Create Invitation DTO

**File:** `api/src/invitations/dto/create-invitation.dto.ts`

```typescript
import { IsEmail, IsString, IsIn } from 'class-validator';
import { Role } from '../../common/entities';

export class CreateInvitationDto {
  @IsString()
  workspaceId: string;

  @IsEmail()
  email: string;

  @IsIn(['admin', 'editor', 'viewer'])
  role: Exclude<Role, 'owner'>;
}
```

### 1.2 Accept Invitation DTO

**File:** `api/src/invitations/dto/accept-invitation.dto.ts`

```typescript
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  token: string;

  // For new users only
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  // For new users only
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}

export class InvitationDetailsDto {
  id: string;
  workspace: {
    id: string;
    name: string;
    website: string;
    logo_url?: string;
  };
  email: string;
  role: string;
  inviter: {
    name: string;
  };
  existingUser: boolean;
  expiresAt: string;
}
```

---

## Task 2: Invitations Service

**File:** `api/src/invitations/invitations.service.ts`

```typescript
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
import { generateId, generateToken, hashToken, verifyTokenHash } from '../common/crypto';
import { Invitation, InvitationWithInviter, Role, WorkspaceMembership } from '../common/entities';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto, InvitationDetailsDto } from './dto/accept-invitation.dto';

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
    const result = await this.clickhouse.querySystem<Invitation>(`
      SELECT * FROM invitations FINAL
      WHERE workspace_id = {workspaceId:String}
        AND status = 'pending'
        AND expires_at > now()
      ORDER BY created_at DESC
    `, { workspaceId });

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
    const workspace = await this.workspacesService.get(dto.workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Check if already a member
    const existingMembership = await this.getMembership(dto.workspaceId, email);
    if (existingMembership) {
      throw new ConflictException('User is already a member of this workspace');
    }

    // Check for pending invitation
    const existingInvitation = await this.findPendingByEmail(dto.workspaceId, email);
    if (existingInvitation) {
      throw new ConflictException(
        'Invitation already pending for this email. Use resend to send again.',
      );
    }

    const id = generateId();
    const { token, hash } = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const invitation: Invitation = {
      id,
      workspace_id: dto.workspaceId,
      email,
      role: dto.role,
      token_hash: hash,
      invited_by: invitedBy,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      accepted_at: null,
      revoked_at: null,
      revoked_by: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await this.clickhouse.insertSystem('invitations', [invitation]);

    // Send invitation email
    const inviter = await this.usersService.findById(invitedBy);
    const baseUrl = this.configService.get<string>('APP_URL', 'http://localhost:5173');

    await this.mailService.sendInvitation(dto.workspaceId, email, {
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
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.clickhouse.insertSystem('invitations', [{
      ...invitation,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    }]);

    // Send email
    const workspace = await this.workspacesService.get(invitation.workspace_id);
    const inviter = await this.usersService.findById(invitedBy);
    const baseUrl = this.configService.get<string>('APP_URL', 'http://localhost:5173');

    await this.mailService.sendInvitation(invitation.workspace_id, invitation.email, {
      inviterName: inviter?.name || 'A team member',
      workspaceName: workspace!.name,
      role: invitation.role,
      inviteUrl: `${baseUrl}/invite/${token}`,
      workspaceWebsite: workspace!.website,
    });
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

    const now = new Date().toISOString();

    await this.clickhouse.insertSystem('invitations', [{
      ...invitation,
      status: 'revoked',
      revoked_at: now,
      revoked_by: revokedBy,
      updated_at: now,
    }]);
  }

  /**
   * Get invitation details by token (public endpoint)
   */
  async getByToken(token: string): Promise<InvitationDetailsDto | null> {
    const tokenHash = hashToken(token);

    const result = await this.clickhouse.querySystem<Invitation>(`
      SELECT * FROM invitations FINAL
      WHERE token_hash = {tokenHash:String}
      LIMIT 1
    `, { tokenHash });

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
    if (new Date(invitation.expires_at) < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    const workspace = await this.workspacesService.get(invitation.workspace_id);
    const inviter = await this.usersService.findById(invitation.invited_by);
    const existingUser = await this.usersService.findByEmail(invitation.email);

    return {
      id: invitation.id,
      workspace: {
        id: workspace!.id,
        name: workspace!.name,
        website: workspace!.website,
        logo_url: workspace!.logo_url,
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
  async accept(dto: AcceptInvitationDto, currentUserId?: string): Promise<{
    userId: string;
    workspaceId: string;
  }> {
    const tokenHash = hashToken(dto.token);

    const result = await this.clickhouse.querySystem<Invitation>(`
      SELECT * FROM invitations FINAL
      WHERE token_hash = {tokenHash:String}
      LIMIT 1
    `, { tokenHash });

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

    if (new Date(invitation.expires_at) < new Date()) {
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
    const now = new Date().toISOString();
    const membershipId = generateId();

    await this.clickhouse.insertSystem('workspace_memberships', [{
      id: membershipId,
      workspace_id: invitation.workspace_id,
      user_id: userId,
      role: invitation.role,
      invited_by: invitation.invited_by,
      joined_at: now,
      created_at: now,
      updated_at: now,
    }]);

    // Mark invitation as accepted
    await this.clickhouse.insertSystem('invitations', [{
      ...invitation,
      status: 'accepted',
      accepted_at: now,
      updated_at: now,
    }]);

    // Send welcome email
    const workspace = await this.workspacesService.get(invitation.workspace_id);
    const user = await this.usersService.findById(userId);
    const baseUrl = this.configService.get<string>('APP_URL', 'http://localhost:5173');

    await this.mailService.sendWelcome(invitation.workspace_id, invitation.email, {
      userName: user!.name,
      workspaceName: workspace!.name,
      role: invitation.role,
      dashboardUrl: `${baseUrl}/workspaces/${invitation.workspace_id}`,
    });

    return {
      userId,
      workspaceId: invitation.workspace_id,
    };
  }

  private async findById(id: string): Promise<Invitation | null> {
    const result = await this.clickhouse.querySystem<Invitation>(`
      SELECT * FROM invitations FINAL
      WHERE id = {id:String}
      LIMIT 1
    `, { id });

    return result[0] || null;
  }

  private async findPendingByEmail(
    workspaceId: string,
    email: string,
  ): Promise<Invitation | null> {
    const result = await this.clickhouse.querySystem<Invitation>(`
      SELECT * FROM invitations FINAL
      WHERE workspace_id = {workspaceId:String}
        AND email = {email:String}
        AND status = 'pending'
        AND expires_at > now()
      LIMIT 1
    `, { workspaceId, email });

    return result[0] || null;
  }

  private async getMembership(
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceMembership | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const result = await this.clickhouse.querySystem<WorkspaceMembership>(`
      SELECT * FROM workspace_memberships FINAL
      WHERE workspace_id = {workspaceId:String}
        AND user_id = {userId:String}
      LIMIT 1
    `, { workspaceId, userId: user.id });

    return result[0] || null;
  }
}
```

---

## Task 3: Invitations Controller

**File:** `api/src/invitations/invitations.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto, InvitationDetailsDto } from './dto/accept-invitation.dto';
import { InvitationWithInviter } from '../common/entities';

@ApiTags('invitations')
@Controller('api')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get('invitations.list')
  @ApiSecurity('jwt-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List workspace invitations' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of pending invitations' })
  async list(
    @Query('workspaceId') workspaceId: string,
  ): Promise<InvitationWithInviter[]> {
    return this.invitationsService.list(workspaceId);
  }

  @Post('invitations.create')
  @ApiSecurity('jwt-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send invitation email' })
  @ApiResponse({ status: 201, description: 'Invitation created and email sent' })
  async create(
    @Request() req,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(dto, req.user.id);
  }

  @Post('invitations.resend')
  @ApiSecurity('jwt-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Resend invitation email' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Invitation email resent' })
  async resend(
    @Request() req,
    @Query('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.invitationsService.resend(id, req.user.id);
    return { success: true };
  }

  @Post('invitations.revoke')
  @ApiSecurity('jwt-auth')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke pending invitation' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Invitation revoked' })
  async revoke(
    @Request() req,
    @Query('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.invitationsService.revoke(id, req.user.id);
    return { success: true };
  }

  @Get('invitations.get')
  @Public()
  @ApiOperation({ summary: 'Get invitation details by token' })
  @ApiQuery({ name: 'token', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Invitation details' })
  async get(@Query('token') token: string): Promise<InvitationDetailsDto | null> {
    return this.invitationsService.getByToken(token);
  }

  @Post('invitations.accept')
  @Public()
  @ApiOperation({ summary: 'Accept invitation' })
  @ApiResponse({ status: 200, description: 'Invitation accepted' })
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Request() req,
  ): Promise<{ userId: string; workspaceId: string }> {
    // If user is logged in, pass their ID
    const currentUserId = req.user?.id;
    return this.invitationsService.accept(dto, currentUserId);
  }
}
```

---

## Task 4: Invitations Module

**File:** `api/src/invitations/invitations.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    MailModule,
    WorkspacesModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
```

---

## Task 5: Unit Tests

**File:** `api/src/invitations/invitations.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from './invitations.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ConflictException, BadRequestException } from '@nestjs/common';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let usersService: jest.Mocked<UsersService>;
  let mailService: jest.Mocked<MailService>;
  let workspacesService: jest.Mocked<WorkspacesService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: ClickHouseService,
          useValue: { querySystem: jest.fn(), insertSystem: jest.fn() },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn(), findByEmail: jest.fn(), create: jest.fn() },
        },
        {
          provide: MailService,
          useValue: { sendInvitation: jest.fn(), sendWelcome: jest.fn() },
        },
        {
          provide: WorkspacesService,
          useValue: { get: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:5173') },
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
    clickhouse = module.get(ClickHouseService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    workspacesService = module.get(WorkspacesService);
  });

  describe('create', () => {
    it('should create invitation and send email', async () => {
      workspacesService.get.mockResolvedValue({
        id: 'ws-1',
        name: 'Test Workspace',
        website: 'https://example.com',
      } as any);
      clickhouse.querySystem.mockResolvedValue([]); // No existing membership or invitation
      usersService.findById.mockResolvedValue({ name: 'Admin' } as any);
      usersService.findByEmail.mockResolvedValue(null);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      const result = await service.create(
        { workspaceId: 'ws-1', email: 'new@example.com', role: 'editor' },
        'admin-1',
      );

      expect(result.email).toBe('new@example.com');
      expect(result.role).toBe('editor');
      expect(result.status).toBe('pending');
      expect(mailService.sendInvitation).toHaveBeenCalled();
    });

    it('should reject if user is already a member', async () => {
      workspacesService.get.mockResolvedValue({ id: 'ws-1' } as any);
      usersService.findByEmail.mockResolvedValue({ id: 'user-1' } as any);
      clickhouse.querySystem.mockResolvedValue([{ id: 'membership-1' }]); // Existing membership

      await expect(
        service.create(
          { workspaceId: 'ws-1', email: 'member@example.com', role: 'editor' },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject duplicate pending invitations', async () => {
      workspacesService.get.mockResolvedValue({ id: 'ws-1' } as any);
      usersService.findByEmail.mockResolvedValue(null);
      clickhouse.querySystem
        .mockResolvedValueOnce([]) // No membership
        .mockResolvedValueOnce([{ id: 'inv-1', status: 'pending' }]); // Pending invitation

      await expect(
        service.create(
          { workspaceId: 'ws-1', email: 'pending@example.com', role: 'editor' },
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('accept', () => {
    it('should accept invitation for new user', async () => {
      const tokenHash = require('../common/crypto').hashToken('valid-token');
      clickhouse.querySystem.mockResolvedValue([{
        id: 'inv-1',
        workspace_id: 'ws-1',
        email: 'new@example.com',
        role: 'editor',
        token_hash: tokenHash,
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }]);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ id: 'user-new' } as any);
      usersService.findById.mockResolvedValue({ name: 'New User' } as any);
      workspacesService.get.mockResolvedValue({ name: 'Workspace' } as any);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendWelcome.mockResolvedValue(undefined);

      const result = await service.accept({
        token: 'valid-token',
        name: 'New User',
        password: 'password123',
      });

      expect(result.userId).toBe('user-new');
      expect(result.workspaceId).toBe('ws-1');
      expect(usersService.create).toHaveBeenCalled();
    });

    it('should accept invitation for existing user', async () => {
      const tokenHash = require('../common/crypto').hashToken('valid-token');
      clickhouse.querySystem.mockResolvedValue([{
        id: 'inv-1',
        workspace_id: 'ws-1',
        email: 'existing@example.com',
        role: 'editor',
        token_hash: tokenHash,
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }]);
      usersService.findByEmail.mockResolvedValue({ id: 'user-existing' } as any);
      usersService.findById.mockResolvedValue({ name: 'Existing User' } as any);
      workspacesService.get.mockResolvedValue({ name: 'Workspace' } as any);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendWelcome.mockResolvedValue(undefined);

      const result = await service.accept({ token: 'valid-token' });

      expect(result.userId).toBe('user-existing');
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should reject expired invitations', async () => {
      clickhouse.querySystem.mockResolvedValue([{
        id: 'inv-1',
        status: 'pending',
        expires_at: new Date(Date.now() - 86400000).toISOString(), // Expired
      }]);

      await expect(
        service.accept({ token: 'expired-token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
```

---

## Deliverables Checklist

- [ ] `api/src/invitations/invitations.module.ts`
- [ ] `api/src/invitations/invitations.service.ts`
- [ ] `api/src/invitations/invitations.controller.ts`
- [ ] `api/src/invitations/dto/create-invitation.dto.ts`
- [ ] `api/src/invitations/dto/accept-invitation.dto.ts`
- [ ] `api/src/invitations/invitations.service.spec.ts`
- [ ] Module registered in `app.module.ts`
- [ ] All tests passing
- [ ] OpenAPI spec updated

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `invitations.list` | GET | Yes | List pending invitations |
| `invitations.create` | POST | Yes | Send invitation email |
| `invitations.resend` | POST | Yes | Resend invitation email |
| `invitations.revoke` | POST | Yes | Revoke pending invitation |
| `invitations.get` | GET | No | Get invitation by token |
| `invitations.accept` | POST | No | Accept invitation |

---

## Acceptance Criteria

1. Admins/owners can invite users by email
2. Invitation emails are sent with secure tokens
3. Tokens expire after 7 days
4. Duplicate invitations are prevented
5. Already-members cannot be re-invited
6. New users can register while accepting
7. Existing users just confirm to join
8. Email mismatch is detected (wrong account logged in)
9. Revoked invitations cannot be accepted
10. Welcome email is sent after accepting
11. Workspace membership is created correctly
12. Unit tests have >80% coverage

---

## Environment Variables

Add to `.env.example`:

```
# Application URL for email links
APP_URL=http://localhost:5173
```
