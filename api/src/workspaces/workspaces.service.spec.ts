import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { ClickHouseService } from '../database/clickhouse.service';
import {
  Workspace,
  DEFAULT_WORKSPACE_SETTINGS,
} from './entities/workspace.entity';

const mockSuperAdminUser = {
  id: 'user-admin-001',
  email: 'admin@test.com',
  name: 'Admin User',
  isSuperAdmin: true,
};

const mockRegularUser = {
  id: 'user-regular-001',
  email: 'regular@test.com',
  name: 'Regular User',
  isSuperAdmin: false,
};

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  const mockWorkspace: Workspace = {
    id: 'ws-test-001',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    logo_url: 'https://example.com/logo.png',
    status: 'active',
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
    settings: {
      ...DEFAULT_WORKSPACE_SETTINGS,
    },
  };

  // ClickHouse stores settings as JSON string
  const mockWorkspaceRow = {
    ...mockWorkspace,
    settings: JSON.stringify(mockWorkspace.settings),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
            commandSystem: jest.fn(),
            createWorkspaceDatabase: jest.fn(),
            dropWorkspaceDatabase: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-encryption-key'),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
    clickhouse = module.get(ClickHouseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    describe('for super admin users', () => {
      it('returns all workspaces without filtering', async () => {
        clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);

        const result = await service.list(mockSuperAdminUser);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('ws-test-001');
        expect(result[0].name).toBe('Test Workspace');
        // Should NOT include membership filter
        expect(clickhouse.querySystem).toHaveBeenCalledWith(
          expect.not.stringContaining('workspace_memberships'),
        );
      });

      it('returns empty array when no workspaces', async () => {
        clickhouse.querySystem.mockResolvedValue([]);

        const result = await service.list(mockSuperAdminUser);

        expect(result).toEqual([]);
      });

      it('parses settings JSON correctly', async () => {
        clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);

        const result = await service.list(mockSuperAdminUser);

        expect(result[0].settings).toEqual(mockWorkspace.settings);
        expect(result[0].settings.timescore_reference).toBe(60);
      });
    });

    describe('for regular users', () => {
      it('returns only workspaces where user is a member', async () => {
        clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);

        const result = await service.list(mockRegularUser);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('ws-test-001');
        // Should include membership filter with user ID
        expect(clickhouse.querySystem).toHaveBeenCalledWith(
          expect.stringContaining('workspace_memberships'),
          { userId: mockRegularUser.id },
        );
      });

      it('returns empty array when user has no memberships', async () => {
        clickhouse.querySystem.mockResolvedValue([]);

        const result = await service.list(mockRegularUser);

        expect(result).toEqual([]);
      });
    });
  });

  describe('get', () => {
    it('returns workspace by ID', async () => {
      clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);

      const result = await service.get('ws-test-001');

      expect(result.id).toBe('ws-test-001');
      expect(result.name).toBe('Test Workspace');
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id ='),
        { id: 'ws-test-001' },
      );
    });

    it('throws NotFoundException for non-existent workspace', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.get('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates workspace with default settings', async () => {
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(
        {
          id: 'ws-new-001',
          name: 'New Workspace',
          website: 'https://new.example.com',
          timezone: 'America/New_York',
          currency: 'EUR',
        },
        mockSuperAdminUser,
      );

      expect(result.id).toBe('ws-new-001');
      expect(result.name).toBe('New Workspace');
      expect(result.status).toBe('initializing');
      expect(result.settings.timescore_reference).toBe(60);
      expect(result.settings.bounce_threshold).toBe(10);
    });

    it('creates workspace database before inserting row', async () => {
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.create(
        {
          id: 'ws-new-001',
          name: 'New Workspace',
          website: 'https://new.example.com',
          timezone: 'UTC',
          currency: 'USD',
        },
        mockSuperAdminUser,
      );

      expect(clickhouse.createWorkspaceDatabase).toHaveBeenCalledWith(
        'ws-new-001',
      );
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'workspaces',
        expect.arrayContaining([expect.objectContaining({ id: 'ws-new-001' })]),
      );
    });

    it('applies custom settings when provided', async () => {
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(
        {
          id: 'ws-new-001',
          name: 'New Workspace',
          website: 'https://new.example.com',
          timezone: 'UTC',
          currency: 'USD',
          settings: {
            timescore_reference: 120,
            bounce_threshold: 5,
          },
        },
        mockSuperAdminUser,
      );

      expect(result.settings.timescore_reference).toBe(120);
      expect(result.settings.bounce_threshold).toBe(5);
    });

    it('throws ForbiddenException for non-super_admin user', async () => {
      await expect(
        service.create(
          {
            id: 'ws-new-001',
            name: 'New Workspace',
            website: 'https://new.example.com',
            timezone: 'UTC',
            currency: 'USD',
          },
          mockRegularUser,
        ),
      ).rejects.toThrow(ForbiddenException);

      // Ensure no database operations were performed
      expect(clickhouse.createWorkspaceDatabase).not.toHaveBeenCalled();
      expect(clickhouse.insertSystem).not.toHaveBeenCalled();
    });

    it('adds creator as owner to workspace_memberships', async () => {
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.create(
        {
          id: 'ws-new-001',
          name: 'New Workspace',
          website: 'https://new.example.com',
          timezone: 'UTC',
          currency: 'USD',
        },
        mockSuperAdminUser,
      );

      // Should insert into workspace_memberships
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'workspace_memberships',
        expect.arrayContaining([
          expect.objectContaining({
            workspace_id: 'ws-new-001',
            user_id: mockSuperAdminUser.id,
            role: 'owner',
            invited_by: null,
          }),
        ]),
      );
    });
  });

  describe('update', () => {
    it('updates workspace properties', async () => {
      clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.update({
        id: 'ws-test-001',
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.website).toBe('https://example.com'); // unchanged
    });

    it('merges settings correctly', async () => {
      clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.update({
        id: 'ws-test-001',
        settings: {
          timescore_reference: 180,
        },
      });

      expect(result.settings.timescore_reference).toBe(180);
      expect(result.settings.bounce_threshold).toBe(10); // unchanged
    });

    it('preserves annotations when updating other settings', async () => {
      const workspaceWithAnnotations = {
        ...mockWorkspace,
        settings: {
          ...mockWorkspace.settings,
          annotations: [
            {
              id: 'ann-1',
              date: '2025-01-01',
              title: 'Product Launch',
              timezone: 'UTC',
            },
          ],
        },
      };
      const rowWithAnnotations = {
        ...workspaceWithAnnotations,
        settings: JSON.stringify(workspaceWithAnnotations.settings),
      };

      clickhouse.querySystem.mockResolvedValue([rowWithAnnotations]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.update({
        id: 'ws-test-001',
        name: 'New Name',
      });

      expect(result.settings.annotations).toHaveLength(1);
      expect(result.settings.annotations?.[0].id).toBe('ann-1');
      expect(result.settings.annotations?.[0].title).toBe('Product Launch');
    });

    it('throws NotFoundException for non-existent workspace', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.update({
          id: 'non-existent',
          name: 'Updated',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes old row and inserts updated row', async () => {
      clickhouse.querySystem.mockResolvedValue([mockWorkspaceRow]);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.update({
        id: 'ws-test-001',
        name: 'Updated',
      });

      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining("DELETE WHERE id = 'ws-test-001'"),
      );
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'workspaces',
        expect.any(Array),
      );
    });
  });

  describe('delete', () => {
    it('deletes workspace and drops database', async () => {
      clickhouse.querySystem.mockResolvedValue([{ id: 'ws-test-001' }]);
      clickhouse.dropWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.commandSystem.mockResolvedValue(undefined);

      await service.delete('ws-test-001');

      expect(clickhouse.dropWorkspaceDatabase).toHaveBeenCalledWith(
        'ws-test-001',
      );
      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining("DELETE WHERE id = 'ws-test-001'"),
      );
    });

    it('throws NotFoundException for non-existent workspace', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.delete('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
