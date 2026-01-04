import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MembersService } from './members.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import {
  WorkspaceMembership,
  MemberWithUser,
} from '../common/entities/membership.entity';

describe('MembersService', () => {
  let service: MembersService;
  let clickhouseService: jest.Mocked<ClickHouseService>;
  let usersService: jest.Mocked<UsersService>;
  let auditService: jest.Mocked<AuditService>;
  let authService: jest.Mocked<AuthService>;

  // Test data
  const workspaceId = 'ws_test123';
  const ownerId = 'user_owner';
  const adminId = 'user_admin';
  const editorId = 'user_editor';
  const viewerId = 'user_viewer';

  const ownerMembership: WorkspaceMembership = {
    id: 'mem_owner',
    workspace_id: workspaceId,
    user_id: ownerId,
    role: 'owner',
    invited_by: null,
    joined_at: '2024-01-01 00:00:00',
    created_at: '2024-01-01 00:00:00',
    updated_at: '2024-01-01 00:00:00',
  };

  const adminMembership: WorkspaceMembership = {
    id: 'mem_admin',
    workspace_id: workspaceId,
    user_id: adminId,
    role: 'admin',
    invited_by: ownerId,
    joined_at: '2024-01-02 00:00:00',
    created_at: '2024-01-02 00:00:00',
    updated_at: '2024-01-02 00:00:00',
  };

  const editorMembership: WorkspaceMembership = {
    id: 'mem_editor',
    workspace_id: workspaceId,
    user_id: editorId,
    role: 'editor',
    invited_by: adminId,
    joined_at: '2024-01-03 00:00:00',
    created_at: '2024-01-03 00:00:00',
    updated_at: '2024-01-03 00:00:00',
  };

  const viewerMembership: WorkspaceMembership = {
    id: 'mem_viewer',
    workspace_id: workspaceId,
    user_id: viewerId,
    role: 'viewer',
    invited_by: adminId,
    joined_at: '2024-01-04 00:00:00',
    created_at: '2024-01-04 00:00:00',
    updated_at: '2024-01-04 00:00:00',
  };

  const ownerUser = {
    id: ownerId,
    email: 'owner@test.com',
    name: 'Owner User',
    type: 'user' as const,
    status: 'active' as const,
    is_super_admin: false,
    password_hash: 'hash',
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: '2024-01-01 00:00:00',
    deleted_at: null,
    deleted_by: null,
    created_at: '2024-01-01 00:00:00',
    updated_at: '2024-01-01 00:00:00',
  };

  const adminUser = {
    id: adminId,
    email: 'admin@test.com',
    name: 'Admin User',
    type: 'user' as const,
    status: 'active' as const,
    is_super_admin: false,
    password_hash: 'hash',
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: '2024-01-02 00:00:00',
    deleted_at: null,
    deleted_by: null,
    created_at: '2024-01-02 00:00:00',
    updated_at: '2024-01-02 00:00:00',
  };

  const editorUser = {
    id: editorId,
    email: 'editor@test.com',
    name: 'Editor User',
    type: 'user' as const,
    status: 'active' as const,
    is_super_admin: false,
    password_hash: 'hash',
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: '2024-01-03 00:00:00',
    deleted_at: null,
    deleted_by: null,
    created_at: '2024-01-03 00:00:00',
    updated_at: '2024-01-03 00:00:00',
  };

  const viewerUser = {
    id: viewerId,
    email: 'viewer@test.com',
    name: 'Viewer User',
    type: 'user' as const,
    status: 'active' as const,
    is_super_admin: false,
    password_hash: 'hash',
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: '2024-01-04 00:00:00',
    deleted_at: null,
    deleted_by: null,
    created_at: '2024-01-04 00:00:00',
    updated_at: '2024-01-04 00:00:00',
  };

  beforeEach(async () => {
    // Create mock services
    const mockClickHouseService = {
      querySystem: jest.fn(),
      insertSystem: jest.fn(),
      commandSystem: jest.fn(),
    };

    const mockUsersService = {
      findById: jest.fn(),
    };

    const mockAuditService = {
      log: jest.fn(),
    };

    const mockAuthService = {
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        {
          provide: ClickHouseService,
          useValue: mockClickHouseService,
        },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
    clickhouseService = module.get(ClickHouseService);
    usersService = module.get(UsersService);
    auditService = module.get(AuditService);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should return members with user details', async () => {
      // Mock actor membership check
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        // Mock list of all members
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ]);

      // Mock user lookups
      usersService.findById
        .mockResolvedValueOnce(ownerUser)
        .mockResolvedValueOnce(adminUser);

      const result = await service.list({ workspace_id: workspaceId }, ownerId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        ...ownerMembership,
        user: {
          id: ownerUser.id,
          email: ownerUser.email,
          name: ownerUser.name,
          status: ownerUser.status,
        },
      });
      expect(result[1]).toEqual({
        ...adminMembership,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          status: adminUser.status,
        },
      });
    });

    it('should throw ForbiddenException when actor is not a member', async () => {
      clickhouseService.querySystem.mockResolvedValue([]);

      await expect(
        service.list({ workspace_id: workspaceId }, 'not_a_member'),
      ).rejects.toThrow('Not a member of this workspace');
    });

    it('should skip members without user details', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ]);

      // First user exists, second doesn't
      usersService.findById.mockResolvedValueOnce(ownerUser).mockResolvedValueOnce(null);

      const result = await service.list({ workspace_id: workspaceId }, ownerId);

      expect(result).toHaveLength(1);
      expect(result[0].user.id).toBe(ownerId);
    });
  });

  describe('get', () => {
    it('should return single member with user details', async () => {
      // Mock actor membership check
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        // Mock target membership
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ]);

      usersService.findById.mockResolvedValueOnce(adminUser);

      const result = await service.get(
        { workspace_id: workspaceId, user_id: adminId },
        ownerId,
      );

      expect(result).toEqual({
        ...adminMembership,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          status: adminUser.status,
        },
      });
    });

    it('should throw NotFoundException when member not found', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(
        service.get(
          { workspace_id: workspaceId, user_id: 'nonexistent' },
          ownerId,
        ),
      ).rejects.toThrow('Member not found');
    });

    it('should throw NotFoundException when user not found', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ]);

      usersService.findById.mockResolvedValueOnce(null);

      await expect(
        service.get({ workspace_id: workspaceId, user_id: adminId }, ownerId),
      ).rejects.toThrow('User not found');
    });

    it('should throw ForbiddenException when actor is not a member', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([]);

      await expect(
        service.get({ workspace_id: workspaceId, user_id: adminId }, 'not_a_member'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateRole', () => {
    it('should successfully update role as owner', async () => {
      // Mock actor (owner) membership
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        // Mock target (editor) membership
        .mockResolvedValueOnce([
          {
            ...editorMembership,
            workspace_id: workspaceId,
            user_id: editorId,
            invited_by: adminId,
          },
        ]);

      usersService.findById.mockResolvedValueOnce(editorUser);

      const result = await service.updateRole(
        {
          workspace_id: workspaceId,
          user_id: editorId,
          role: 'admin',
        },
        ownerId,
      );

      expect(clickhouseService.insertSystem).toHaveBeenCalledWith(
        'workspace_memberships',
        expect.arrayContaining([
          expect.objectContaining({
            id: editorMembership.id,
            workspace_id: workspaceId,
            user_id: editorId,
            role: 'admin',
          }),
        ]),
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: ownerId,
          workspace_id: workspaceId,
          action: 'member.role_updated',
          target_type: 'membership',
          target_id: editorMembership.id,
          metadata: {
            user_id: editorId,
            old_role: 'editor',
            new_role: 'admin',
          },
        }),
      );

      expect(result.role).toBe('admin');
      expect(result.user.id).toBe(editorId);
    });

    it('should successfully update role as admin for lower roles', async () => {
      // Admin updating editor to viewer
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...editorMembership,
            workspace_id: workspaceId,
            user_id: editorId,
            invited_by: adminId,
          },
        ]);

      usersService.findById.mockResolvedValueOnce(editorUser);

      await service.updateRole(
        {
          workspace_id: workspaceId,
          user_id: editorId,
          role: 'viewer',
        },
        adminId,
      );

      expect(clickhouseService.insertSystem).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when actor lacks permission', async () => {
      // Editor trying to update viewer
      clickhouseService.querySystem.mockResolvedValueOnce([
        {
          ...editorMembership,
          workspace_id: workspaceId,
          user_id: editorId,
          invited_by: adminId,
        },
      ]);

      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: viewerId,
            role: 'admin',
          },
          editorId,
        ),
      ).rejects.toThrow('Insufficient permissions to manage members');
    });

    it('should throw BadRequestException when trying to modify self', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ]);

      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: ownerId,
            role: 'admin',
          },
          ownerId,
        ),
      ).rejects.toThrow('Cannot modify your own role');
    });

    it('should throw ForbiddenException when trying to modify higher role', async () => {
      // Admin trying to modify owner
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ]);

      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: ownerId,
            role: 'viewer',
          },
          adminId,
        ),
      ).rejects.toThrow('Cannot modify a member with equal or higher role');
    });

    it('should throw ForbiddenException when trying to modify equal role', async () => {
      // Admin trying to modify another admin
      const otherAdminMembership = {
        ...adminMembership,
        id: 'mem_admin2',
        user_id: 'user_admin2',
      };

      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...otherAdminMembership,
            workspace_id: workspaceId,
            user_id: 'user_admin2',
            invited_by: ownerId,
          },
        ]);

      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: 'user_admin2',
            role: 'editor',
          },
          adminId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when trying to promote to same or higher role', async () => {
      // Admin trying to promote editor to admin
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...editorMembership,
            workspace_id: workspaceId,
            user_id: editorId,
            invited_by: adminId,
          },
        ]);

      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: editorId,
            role: 'admin',
          },
          adminId,
        ),
      ).rejects.toThrow('Cannot promote a member to your role or higher');
    });

    it('should throw ForbiddenException when non-owner tries to create owner', async () => {
      // Admin trying to promote editor to owner
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...editorMembership,
            workspace_id: workspaceId,
            user_id: editorId,
            invited_by: adminId,
          },
        ]);

      // The check for "Cannot promote a member to your role or higher" happens before
      // the check for "Only owners can promote members to owner"
      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: editorId,
            role: 'owner',
          },
          adminId,
        ),
      ).rejects.toThrow('Cannot promote a member to your role or higher');
    });

    it('should throw NotFoundException when target member not found', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(
        service.updateRole(
          {
            workspace_id: workspaceId,
            user_id: 'nonexistent',
            role: 'admin',
          },
          ownerId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should successfully remove member as owner', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...editorMembership,
            workspace_id: workspaceId,
            user_id: editorId,
            invited_by: adminId,
          },
        ]);

      await service.remove(
        {
          workspace_id: workspaceId,
          user_id: editorId,
        },
        ownerId,
      );

      expect(clickhouseService.commandSystem).toHaveBeenCalledWith(
        `ALTER TABLE workspace_memberships DELETE WHERE id = '${editorMembership.id}'`,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: ownerId,
          workspace_id: workspaceId,
          action: 'member.removed',
          target_type: 'membership',
          target_id: editorMembership.id,
          metadata: {
            user_id: editorId,
            role: 'editor',
            sessions_revoked: true,
          },
        }),
      );

      // Verify sessions were revoked
      expect(authService.revokeAllSessions).toHaveBeenCalledWith(editorId);
    });

    it('should successfully remove member as admin', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...editorMembership,
            workspace_id: workspaceId,
            user_id: editorId,
            invited_by: adminId,
          },
        ]);

      await service.remove(
        {
          workspace_id: workspaceId,
          user_id: editorId,
        },
        adminId,
      );

      expect(clickhouseService.commandSystem).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when actor lacks permission', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([
        {
          ...editorMembership,
          workspace_id: workspaceId,
          user_id: editorId,
          invited_by: adminId,
        },
      ]);

      await expect(
        service.remove(
          {
            workspace_id: workspaceId,
            user_id: viewerId,
          },
          editorId,
        ),
      ).rejects.toThrow('Insufficient permissions to remove members');
    });

    it('should throw BadRequestException when trying to remove self', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ]);

      await expect(
        service.remove(
          {
            workspace_id: workspaceId,
            user_id: ownerId,
          },
          ownerId,
        ),
      ).rejects.toThrow('Cannot remove yourself. Use the leave endpoint instead');
    });

    it('should throw ForbiddenException when trying to remove higher role', async () => {
      // Admin trying to remove owner
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ]);

      await expect(
        service.remove(
          {
            workspace_id: workspaceId,
            user_id: ownerId,
          },
          adminId,
        ),
      ).rejects.toThrow('Cannot remove a member with equal or higher role');
    });

    it('should throw ForbiddenException when owner tries to remove another owner', async () => {
      // Owners cannot remove other owners (equal role hierarchy)
      // They must use transferOwnership instead
      const owner2Id = 'user_owner2';
      const owner2Membership = {
        ...ownerMembership,
        id: 'mem_owner2',
        user_id: owner2Id,
      };

      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...owner2Membership,
            workspace_id: workspaceId,
            user_id: owner2Id,
            invited_by: null,
          },
        ]);

      await expect(
        service.remove(
          {
            workspace_id: workspaceId,
            user_id: owner2Id,
          },
          ownerId,
        ),
      ).rejects.toThrow('Cannot remove a member with equal or higher role');
    });

    it('should throw NotFoundException when target member not found', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(
        service.remove(
          {
            workspace_id: workspaceId,
            user_id: 'nonexistent',
          },
          ownerId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('leave', () => {
    it('should successfully leave workspace as non-owner', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([
        {
          ...editorMembership,
          workspace_id: workspaceId,
          user_id: editorId,
          invited_by: adminId,
        },
      ]);

      await service.leave({ workspace_id: workspaceId }, editorId);

      expect(clickhouseService.commandSystem).toHaveBeenCalledWith(
        `ALTER TABLE workspace_memberships DELETE WHERE id = '${editorMembership.id}'`,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: editorId,
          workspace_id: workspaceId,
          action: 'member.left',
          target_type: 'membership',
          target_id: editorMembership.id,
          metadata: {
            role: 'editor',
          },
        }),
      );
    });

    it('should successfully leave workspace as owner when multiple owners exist', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([{ count: '2' }]);

      await service.leave({ workspace_id: workspaceId }, ownerId);

      expect(clickhouseService.commandSystem).toHaveBeenCalled();
    });

    it('should throw BadRequestException when last owner tries to leave', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([{ count: '1' }]);

      await expect(
        service.leave({ workspace_id: workspaceId }, ownerId),
      ).rejects.toThrow('Cannot leave as the last owner. Transfer ownership first');
    });

    it('should throw NotFoundException when user is not a member', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([]);

      await expect(
        service.leave({ workspace_id: workspaceId }, 'not_a_member'),
      ).rejects.toThrow('Not a member of this workspace');
    });
  });

  describe('transferOwnership', () => {
    it('should successfully transfer ownership', async () => {
      // Mock current owner membership
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        // Mock new owner (admin) membership
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ]);

      usersService.findById.mockResolvedValueOnce(ownerUser).mockResolvedValueOnce(adminUser);

      const result = await service.transferOwnership(
        {
          workspace_id: workspaceId,
          new_owner_id: adminId,
        },
        ownerId,
      );

      // Verify both memberships were updated
      expect(clickhouseService.insertSystem).toHaveBeenCalledWith(
        'workspace_memberships',
        expect.arrayContaining([
          expect.objectContaining({
            id: ownerMembership.id,
            user_id: ownerId,
            role: 'admin',
          }),
          expect.objectContaining({
            id: adminMembership.id,
            user_id: adminId,
            role: 'owner',
          }),
        ]),
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: ownerId,
          workspace_id: workspaceId,
          action: 'ownership.transferred',
          target_type: 'workspace',
          target_id: workspaceId,
          metadata: {
            old_owner_id: ownerId,
            new_owner_id: adminId,
          },
        }),
      );

      expect(result.old_owner.role).toBe('admin');
      expect(result.old_owner.user.id).toBe(ownerId);
      expect(result.new_owner.role).toBe('owner');
      expect(result.new_owner.user.id).toBe(adminId);
    });

    it('should throw ForbiddenException when non-owner tries to transfer', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([
        {
          ...adminMembership,
          workspace_id: workspaceId,
          user_id: adminId,
          invited_by: ownerId,
        },
      ]);

      await expect(
        service.transferOwnership(
          {
            workspace_id: workspaceId,
            new_owner_id: editorId,
          },
          adminId,
        ),
      ).rejects.toThrow('Only owners can transfer ownership');
    });

    it('should throw ForbiddenException when actor is not a member', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([]);

      await expect(
        service.transferOwnership(
          {
            workspace_id: workspaceId,
            new_owner_id: adminId,
          },
          'not_a_member',
        ),
      ).rejects.toThrow('Not a member of this workspace');
    });

    it('should throw BadRequestException when trying to transfer to self', async () => {
      clickhouseService.querySystem.mockResolvedValueOnce([
        {
          ...ownerMembership,
          workspace_id: workspaceId,
          user_id: ownerId,
          invited_by: null,
        },
      ]);

      await expect(
        service.transferOwnership(
          {
            workspace_id: workspaceId,
            new_owner_id: ownerId,
          },
          ownerId,
        ),
      ).rejects.toThrow('Cannot transfer ownership to yourself');
    });

    it('should throw NotFoundException when new owner is not a member', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([]);

      await expect(
        service.transferOwnership(
          {
            workspace_id: workspaceId,
            new_owner_id: 'not_a_member',
          },
          ownerId,
        ),
      ).rejects.toThrow('New owner is not a member of this workspace');
    });

    it('should throw NotFoundException when user details cannot be fetched', async () => {
      clickhouseService.querySystem
        .mockResolvedValueOnce([
          {
            ...ownerMembership,
            workspace_id: workspaceId,
            user_id: ownerId,
            invited_by: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            ...adminMembership,
            workspace_id: workspaceId,
            user_id: adminId,
            invited_by: ownerId,
          },
        ]);

      usersService.findById.mockResolvedValueOnce(null);

      await expect(
        service.transferOwnership(
          {
            workspace_id: workspaceId,
            new_owner_id: adminId,
          },
          ownerId,
        ),
      ).rejects.toThrow('User not found');
    });
  });
});
