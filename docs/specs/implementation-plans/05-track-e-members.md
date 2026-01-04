# Track E: Members Module Implementation Plan

**Track:** E - Members Module
**Dependencies:** Track A (Users)
**Blocks:** None (end-user feature)

---

## Overview

The Members module manages workspace memberships, including role changes, member removal, and ownership transfer. It enforces role hierarchy and owner protection rules.

---

## Files to Create

```
api/src/members/
├── members.module.ts
├── members.service.ts
├── members.controller.ts
├── members.service.spec.ts
├── guards/
│   └── workspace-role.guard.ts
├── decorators/
│   └── require-permission.decorator.ts
└── dto/
    ├── update-role.dto.ts
    └── transfer-ownership.dto.ts
```

---

## Task 1: DTOs

### 1.1 Update Role DTO

**File:** `api/src/members/dto/update-role.dto.ts`

```typescript
import { IsString, IsIn } from 'class-validator';
import { Role } from '../../common/entities';

export class UpdateRoleDto {
  @IsString()
  workspaceId: string;

  @IsString()
  userId: string;

  @IsIn(['admin', 'editor', 'viewer'])
  role: Exclude<Role, 'owner'>;
}
```

### 1.2 Transfer Ownership DTO

**File:** `api/src/members/dto/transfer-ownership.dto.ts`

```typescript
import { IsString } from 'class-validator';

export class TransferOwnershipDto {
  @IsString()
  workspaceId: string;

  @IsString()
  newOwnerId: string;
}
```

---

## Task 2: Members Service

**File:** `api/src/members/members.service.ts`

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { generateId } from '../common/crypto';
import {
  WorkspaceMembership,
  MemberWithUser,
  Role,
  User,
} from '../common/entities';
import { canModifyMember, hasPermission, ROLE_HIERARCHY } from '../common/permissions';
import { UpdateRoleDto } from './dto/update-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';

@Injectable()
export class MembersService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * List all members of a workspace
   */
  async list(workspaceId: string): Promise<MemberWithUser[]> {
    const memberships = await this.clickhouse.querySystem<WorkspaceMembership>(`
      SELECT * FROM workspace_memberships FINAL
      WHERE workspace_id = {workspaceId:String}
      ORDER BY
        CASE role
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'editor' THEN 3
          ELSE 4
        END,
        joined_at ASC
    `, { workspaceId });

    const members: MemberWithUser[] = [];
    for (const membership of memberships) {
      const user = await this.usersService.findById(membership.user_id);
      if (user && !user.deleted_at) {
        members.push({
          ...membership,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            status: user.status,
          },
        });
      }
    }

    return members;
  }

  /**
   * Get a specific membership
   */
  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership | null> {
    const result = await this.clickhouse.querySystem<WorkspaceMembership>(`
      SELECT * FROM workspace_memberships FINAL
      WHERE workspace_id = {workspaceId:String}
        AND user_id = {userId:String}
      LIMIT 1
    `, { workspaceId, userId });

    return result[0] || null;
  }

  /**
   * Get user's role in a workspace
   */
  async getRole(workspaceId: string, userId: string): Promise<Role | null> {
    const membership = await this.getMembership(workspaceId, userId);
    return membership?.role || null;
  }

  /**
   * Update a member's role
   */
  async updateRole(dto: UpdateRoleDto, actorId: string): Promise<MemberWithUser> {
    const actorMembership = await this.getMembership(dto.workspaceId, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    // Check permission to manage members
    if (!hasPermission(actorMembership.role, 'members.manage')) {
      throw new ForbiddenException('You do not have permission to manage members');
    }

    const targetMembership = await this.getMembership(dto.workspaceId, dto.userId);
    if (!targetMembership) {
      throw new NotFoundException('Member not found');
    }

    // Cannot change owner role
    if (targetMembership.role === 'owner') {
      throw new ForbiddenException('Cannot change owner role. Use ownership transfer.');
    }

    // Cannot promote to same or higher level than yourself
    if (ROLE_HIERARCHY[dto.role] >= ROLE_HIERARCHY[actorMembership.role]) {
      throw new ForbiddenException('Cannot promote member to same or higher role than yourself');
    }

    // Update role
    const now = new Date().toISOString();
    await this.clickhouse.insertSystem('workspace_memberships', [{
      ...targetMembership,
      role: dto.role,
      updated_at: now,
    }]);

    const user = await this.usersService.findById(dto.userId);
    return {
      ...targetMembership,
      role: dto.role,
      updated_at: now,
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        status: user!.status,
      },
    };
  }

  /**
   * Remove a member from workspace
   */
  async remove(
    workspaceId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    const actorMembership = await this.getMembership(workspaceId, actorId);
    if (!actorMembership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    // Check permission
    if (!hasPermission(actorMembership.role, 'members.remove')) {
      throw new ForbiddenException('You do not have permission to remove members');
    }

    const targetMembership = await this.getMembership(workspaceId, userId);
    if (!targetMembership) {
      throw new NotFoundException('Member not found');
    }

    // Cannot remove owner
    if (targetMembership.role === 'owner') {
      throw new ForbiddenException('Cannot remove workspace owner');
    }

    // Role hierarchy check
    if (!canModifyMember(actorMembership.role, targetMembership.role)) {
      throw new ForbiddenException('Cannot remove member with same or higher role');
    }

    // Delete membership (hard delete since we use ReplacingMergeTree)
    // For ClickHouse, we'll mark as deleted by setting a flag or using a different approach
    // Since ReplacingMergeTree doesn't support true deletes, we'll use ALTER DELETE
    await this.clickhouse.commandSystem(`
      ALTER TABLE workspace_memberships
      DELETE WHERE workspace_id = '${workspaceId}' AND user_id = '${userId}'
    `);
  }

  /**
   * Leave a workspace (self-removal)
   */
  async leave(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.getMembership(workspaceId, userId);
    if (!membership) {
      throw new NotFoundException('You are not a member of this workspace');
    }

    // Owner cannot leave without transferring ownership
    if (membership.role === 'owner') {
      throw new ForbiddenException(
        'Owners cannot leave. Transfer ownership first.',
      );
    }

    await this.clickhouse.commandSystem(`
      ALTER TABLE workspace_memberships
      DELETE WHERE workspace_id = '${workspaceId}' AND user_id = '${userId}'
    `);
  }

  /**
   * Transfer workspace ownership
   */
  async transferOwnership(
    dto: TransferOwnershipDto,
    currentOwnerId: string,
  ): Promise<void> {
    const currentOwnerMembership = await this.getMembership(
      dto.workspaceId,
      currentOwnerId,
    );

    if (!currentOwnerMembership || currentOwnerMembership.role !== 'owner') {
      throw new ForbiddenException('Only the owner can transfer ownership');
    }

    const newOwnerMembership = await this.getMembership(
      dto.workspaceId,
      dto.newOwnerId,
    );

    if (!newOwnerMembership) {
      throw new NotFoundException('New owner must be an existing member');
    }

    // New owner should be at least admin
    if (newOwnerMembership.role === 'viewer' || newOwnerMembership.role === 'editor') {
      throw new BadRequestException('Can only transfer ownership to an admin');
    }

    const now = new Date().toISOString();

    // Demote current owner to admin
    await this.clickhouse.insertSystem('workspace_memberships', [{
      ...currentOwnerMembership,
      role: 'admin',
      updated_at: now,
    }]);

    // Promote new owner
    await this.clickhouse.insertSystem('workspace_memberships', [{
      ...newOwnerMembership,
      role: 'owner',
      updated_at: now,
    }]);
  }

  /**
   * Add a member to workspace (used by invitation acceptance)
   */
  async add(
    workspaceId: string,
    userId: string,
    role: Role,
    invitedBy: string | null,
  ): Promise<WorkspaceMembership> {
    const existing = await this.getMembership(workspaceId, userId);
    if (existing) {
      throw new BadRequestException('User is already a member');
    }

    const now = new Date().toISOString();
    const membership: WorkspaceMembership = {
      id: generateId(),
      workspace_id: workspaceId,
      user_id: userId,
      role,
      invited_by: invitedBy,
      joined_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('workspace_memberships', [membership]);

    return membership;
  }

  /**
   * Check if user has permission in workspace
   */
  async checkPermission(
    workspaceId: string,
    userId: string,
    permission: string,
  ): Promise<boolean> {
    const role = await this.getRole(workspaceId, userId);
    if (!role) return false;
    return hasPermission(role, permission as any);
  }
}
```

---

## Task 3: Workspace Role Guard

**File:** `api/src/members/guards/workspace-role.guard.ts`

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembersService } from '../members.service';
import { Permission } from '../../common/permissions';

export const PERMISSION_KEY = 'permission';

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private membersService: MembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<Permission>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    if (!requiredPermission) {
      return true; // No permission required
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const workspaceId =
      request.query?.workspaceId ||
      request.body?.workspaceId ||
      request.params?.workspaceId;

    if (!userId || !workspaceId) {
      throw new ForbiddenException('Missing user or workspace context');
    }

    const hasPermission = await this.membersService.checkPermission(
      workspaceId,
      userId,
      requiredPermission,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `You do not have permission: ${requiredPermission}`,
      );
    }

    return true;
  }
}
```

---

## Task 4: Require Permission Decorator

**File:** `api/src/members/decorators/require-permission.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';
import { Permission } from '../../common/permissions';
import { PERMISSION_KEY } from '../guards/workspace-role.guard';

/**
 * Decorator to require a specific workspace permission
 * Must be used with WorkspaceRoleGuard
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
```

---

## Task 5: Members Controller

**File:** `api/src/members/members.controller.ts`

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
import { WorkspaceRoleGuard } from './guards/workspace-role.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { MembersService } from './members.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { MemberWithUser } from '../common/entities';

@ApiTags('members')
@ApiSecurity('jwt-auth')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
@Controller('api')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get('members.list')
  @ApiOperation({ summary: 'List workspace members' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of workspace members' })
  async list(
    @Query('workspaceId') workspaceId: string,
  ): Promise<MemberWithUser[]> {
    return this.membersService.list(workspaceId);
  }

  @Post('members.updateRole')
  @RequirePermission('members.manage')
  @ApiOperation({ summary: 'Change member role' })
  @ApiResponse({ status: 200, description: 'Member role updated' })
  async updateRole(
    @Request() req,
    @Body() dto: UpdateRoleDto,
  ): Promise<MemberWithUser> {
    return this.membersService.updateRole(dto, req.user.id);
  }

  @Post('members.remove')
  @RequirePermission('members.remove')
  @ApiOperation({ summary: 'Remove member from workspace' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiQuery({ name: 'userId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Member removed' })
  async remove(
    @Request() req,
    @Query('workspaceId') workspaceId: string,
    @Query('userId') userId: string,
  ): Promise<{ success: boolean }> {
    await this.membersService.remove(workspaceId, userId, req.user.id);
    return { success: true };
  }

  @Post('members.leave')
  @ApiOperation({ summary: 'Leave workspace (self)' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Left workspace' })
  async leave(
    @Request() req,
    @Query('workspaceId') workspaceId: string,
  ): Promise<{ success: boolean }> {
    await this.membersService.leave(workspaceId, req.user.id);
    return { success: true };
  }

  @Post('members.transferOwnership')
  @RequirePermission('ownership.transfer')
  @ApiOperation({ summary: 'Transfer ownership to another member' })
  @ApiResponse({ status: 200, description: 'Ownership transferred' })
  async transferOwnership(
    @Request() req,
    @Body() dto: TransferOwnershipDto,
  ): Promise<{ success: boolean }> {
    await this.membersService.transferOwnership(dto, req.user.id);
    return { success: true };
  }
}
```

---

## Task 6: Members Module

**File:** `api/src/members/members.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { WorkspaceRoleGuard } from './guards/workspace-role.guard';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [MembersController],
  providers: [MembersService, WorkspaceRoleGuard],
  exports: [MembersService, WorkspaceRoleGuard],
})
export class MembersModule {}
```

---

## Task 7: Unit Tests

**File:** `api/src/members/members.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MembersService } from './members.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('MembersService', () => {
  let service: MembersService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
            commandSystem: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
    clickhouse = module.get(ClickHouseService);
    usersService = module.get(UsersService);
  });

  describe('updateRole', () => {
    it('should update member role', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'owner', user_id: 'actor-1' }]) // Actor
        .mockResolvedValueOnce([{ role: 'editor', user_id: 'target-1' }]); // Target
      usersService.findById.mockResolvedValue({
        id: 'target-1',
        email: 'target@example.com',
        name: 'Target',
        status: 'active',
      } as any);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.updateRole(
        { workspaceId: 'ws-1', userId: 'target-1', role: 'admin' },
        'actor-1',
      );

      expect(result.role).toBe('admin');
    });

    it('should reject changing owner role', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'owner' }]) // Actor
        .mockResolvedValueOnce([{ role: 'owner' }]); // Target (also owner)

      await expect(
        service.updateRole(
          { workspaceId: 'ws-1', userId: 'target-1', role: 'admin' },
          'actor-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject promotion to higher role than actor', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'admin' }]) // Actor is admin
        .mockResolvedValueOnce([{ role: 'viewer' }]); // Target is viewer

      await expect(
        service.updateRole(
          { workspaceId: 'ws-1', userId: 'target-1', role: 'admin' }, // Trying to make admin
          'actor-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('should remove a member', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'owner' }]) // Actor is owner
        .mockResolvedValueOnce([{ role: 'editor' }]); // Target is editor
      clickhouse.commandSystem.mockResolvedValue(undefined);

      await expect(
        service.remove('ws-1', 'target-1', 'actor-1'),
      ).resolves.not.toThrow();

      expect(clickhouse.commandSystem).toHaveBeenCalled();
    });

    it('should reject removing owner', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'owner' }]) // Actor
        .mockResolvedValueOnce([{ role: 'owner' }]); // Target is owner

      await expect(
        service.remove('ws-1', 'target-1', 'actor-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject removing higher role', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'admin' }]) // Actor is admin
        .mockResolvedValueOnce([{ role: 'admin' }]); // Target is also admin

      await expect(
        service.remove('ws-1', 'target-1', 'actor-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('leave', () => {
    it('should allow non-owner to leave', async () => {
      clickhouse.querySystem.mockResolvedValue([{ role: 'editor' }]);
      clickhouse.commandSystem.mockResolvedValue(undefined);

      await expect(service.leave('ws-1', 'user-1')).resolves.not.toThrow();
    });

    it('should reject owner leaving', async () => {
      clickhouse.querySystem.mockResolvedValue([{ role: 'owner' }]);

      await expect(service.leave('ws-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'owner', user_id: 'owner-1' }])
        .mockResolvedValueOnce([{ role: 'admin', user_id: 'admin-1' }]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await expect(
        service.transferOwnership(
          { workspaceId: 'ws-1', newOwnerId: 'admin-1' },
          'owner-1',
        ),
      ).resolves.not.toThrow();

      expect(clickhouse.insertSystem).toHaveBeenCalledTimes(2);
    });

    it('should reject transfer to non-admin', async () => {
      clickhouse.querySystem
        .mockResolvedValueOnce([{ role: 'owner' }])
        .mockResolvedValueOnce([{ role: 'viewer' }]);

      await expect(
        service.transferOwnership(
          { workspaceId: 'ws-1', newOwnerId: 'viewer-1' },
          'owner-1',
        ),
      ).rejects.toThrow();
    });
  });
});
```

---

## Deliverables Checklist

- [ ] `api/src/members/members.module.ts`
- [ ] `api/src/members/members.service.ts`
- [ ] `api/src/members/members.controller.ts`
- [ ] `api/src/members/guards/workspace-role.guard.ts`
- [ ] `api/src/members/decorators/require-permission.decorator.ts`
- [ ] `api/src/members/dto/update-role.dto.ts`
- [ ] `api/src/members/dto/transfer-ownership.dto.ts`
- [ ] `api/src/members/members.service.spec.ts`
- [ ] Module registered in `app.module.ts`
- [ ] All tests passing
- [ ] OpenAPI spec updated

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `members.list` | GET | Yes | List workspace members |
| `members.updateRole` | POST | Yes | Change member role |
| `members.remove` | POST | Yes | Remove member |
| `members.leave` | POST | Yes | Leave workspace (self) |
| `members.transferOwnership` | POST | Yes | Transfer ownership |

---

## Acceptance Criteria

1. Members are listed in role order (owner first)
2. Role changes respect hierarchy (can't promote above self)
3. Owner role cannot be changed directly
4. Owner cannot be removed
5. Owner cannot leave (must transfer first)
6. Ownership can only transfer to admins
7. After transfer, old owner becomes admin
8. Permission guard works correctly
9. Non-members get appropriate errors
10. Unit tests have >80% coverage

---

## Role Hierarchy Reference

| Role | Level | Can Manage |
|------|-------|------------|
| Owner | 4 | admin, editor, viewer |
| Admin | 3 | editor, viewer |
| Editor | 2 | (none) |
| Viewer | 1 | (none) |
