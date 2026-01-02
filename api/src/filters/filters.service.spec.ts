import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FiltersService } from './filters.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { FilterDefinition } from './entities/filter.entity';

describe('FiltersService', () => {
  let service: FiltersService;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockFilter1: FilterDefinition = {
    id: 'filter-1',
    name: 'Google Traffic',
    priority: 500,
    order: 0,
    tags: ['organic', 'search'],
    conditions: [
      { field: 'referrer_domain', operator: 'contains', value: 'google', logic: 'and' },
    ],
    operations: [
      { dimension: 'channel', action: 'set_value', value: 'Organic Search' },
    ],
    enabled: true,
    version: 'v1',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  };

  const mockFilter2: FilterDefinition = {
    id: 'filter-2',
    name: 'Facebook Ads',
    priority: 500,
    order: 1,
    tags: ['paid', 'social'],
    conditions: [
      { field: 'utm_source', operator: 'equals', value: 'facebook', logic: 'and' },
    ],
    operations: [
      { dimension: 'channel', action: 'set_value', value: 'Paid Social' },
    ],
    enabled: true,
    version: 'v1',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  };

  const mockWorkspace: Workspace = {
    id: 'ws-1',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    logo_url: null,
    timescore_reference: 180,
    bounce_threshold: 10,
    status: 'active',
    custom_dimensions: {},
    filters: [mockFilter1, mockFilter2],
    integrations: [],
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  const mockEmptyWorkspace: Workspace = {
    ...mockWorkspace,
    id: 'ws-empty',
    filters: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiltersService,
        {
          provide: ClickHouseService,
          useValue: {},
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FiltersService>(FiltersService);
    workspacesService = module.get(WorkspacesService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns all filters sorted by order', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.list('ws-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('filter-1');
      expect(result[1].id).toBe('filter-2');
    });

    it('returns empty array for workspace with no filters', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);

      const result = await service.list('ws-empty');

      expect(result).toEqual([]);
    });

    it('filters by tags when provided', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.list('ws-1', ['paid']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('filter-2');
    });

    it('returns filters matching any of the provided tags', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.list('ws-1', ['organic', 'paid']);

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no filters match tags', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.list('ws-1', ['nonexistent']);

      expect(result).toEqual([]);
    });
  });

  describe('get', () => {
    it('returns filter by ID', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.get('ws-1', 'filter-1');

      expect(result.id).toBe('filter-1');
      expect(result.name).toBe('Google Traffic');
    });

    it('throws NotFoundException for non-existent filter', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      await expect(service.get('ws-1', 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a new filter with generated ID', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      const result = await service.create({
        workspace_id: 'ws-empty',
        name: 'New Filter',
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'test', logic: 'and' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Test' },
        ],
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('New Filter');
      expect(result.order).toBe(0);
      expect(result.enabled).toBe(true);
    });

    it('assigns correct order based on existing filters', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      const result = await service.create({
        workspace_id: 'ws-1',
        name: 'Third Filter',
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'test', logic: 'and' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Test' },
        ],
      });

      expect(result.order).toBe(2); // After 0 and 1
    });

    it('emits filters.changed event', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      await service.create({
        workspace_id: 'ws-empty',
        name: 'New Filter',
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'test', logic: 'and' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Test' },
        ],
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith('filters.changed', {
        workspaceId: 'ws-empty',
      });
    });

    it('throws BadRequestException for invalid source field', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);

      await expect(
        service.create({
          workspace_id: 'ws-empty',
          name: 'Invalid Filter',
          conditions: [
            { field: 'invalid_field' as any, operator: 'equals', value: 'test', logic: 'and' },
          ],
          operations: [
            { dimension: 'channel', action: 'set_value', value: 'Test' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid regex pattern', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);

      await expect(
        service.create({
          workspace_id: 'ws-empty',
          name: 'Invalid Regex',
          conditions: [
            { field: 'utm_source', operator: 'regex', value: '[invalid(', logic: 'and' },
          ],
          operations: [
            { dimension: 'channel', action: 'set_value', value: 'Test' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid dimension', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);

      await expect(
        service.create({
          workspace_id: 'ws-empty',
          name: 'Invalid Dimension',
          conditions: [
            { field: 'utm_source', operator: 'equals', value: 'test', logic: 'and' },
          ],
          operations: [
            { dimension: 'invalid_dim' as any, action: 'set_value', value: 'Test' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when set_value has no value', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);

      await expect(
        service.create({
          workspace_id: 'ws-empty',
          name: 'Missing Value',
          conditions: [
            { field: 'utm_source', operator: 'equals', value: 'test', logic: 'and' },
          ],
          operations: [
            { dimension: 'channel', action: 'set_value' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates filter properties', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      const result = await service.update({
        workspace_id: 'ws-1',
        id: 'filter-1',
        name: 'Updated Name',
        priority: 100,
      });

      expect(result.name).toBe('Updated Name');
      expect(result.priority).toBe(100);
    });

    it('throws NotFoundException for non-existent filter', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      await expect(
        service.update({
          workspace_id: 'ws-1',
          id: 'non-existent',
          name: 'Updated',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('emits filters.changed event', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      await service.update({
        workspace_id: 'ws-1',
        id: 'filter-1',
        name: 'Updated',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith('filters.changed', {
        workspaceId: 'ws-1',
      });
    });

    it('validates conditions when provided', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      await expect(
        service.update({
          workspace_id: 'ws-1',
          id: 'filter-1',
          conditions: [
            { field: 'invalid_field' as any, operator: 'equals', value: 'test', logic: 'and' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('removes filter from workspace', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      await service.delete('ws-1', 'filter-1');

      expect(workspacesService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ws-1',
          filters: expect.arrayContaining([
            expect.objectContaining({ id: 'filter-2' }),
          ]),
        }),
      );
    });

    it('throws NotFoundException for non-existent filter', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      await expect(service.delete('ws-1', 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('emits filters.changed event', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      await service.delete('ws-1', 'filter-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith('filters.changed', {
        workspaceId: 'ws-1',
      });
    });
  });

  describe('reorder', () => {
    it('updates filter order based on provided IDs', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      await service.reorder({
        workspace_id: 'ws-1',
        filter_ids: ['filter-2', 'filter-1'],
      });

      expect(workspacesService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.arrayContaining([
            expect.objectContaining({ id: 'filter-1', order: 1 }),
            expect.objectContaining({ id: 'filter-2', order: 0 }),
          ]),
        }),
      );
    });

    it('emits filters.changed event', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      workspacesService.update.mockResolvedValue(undefined);

      await service.reorder({
        workspace_id: 'ws-1',
        filter_ids: ['filter-2', 'filter-1'],
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith('filters.changed', {
        workspaceId: 'ws-1',
      });
    });
  });

  describe('listTags', () => {
    it('returns unique sorted tags', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.listTags('ws-1');

      expect(result).toEqual(['organic', 'paid', 'search', 'social']);
    });

    it('returns empty array for workspace with no filters', async () => {
      workspacesService.get.mockResolvedValue(mockEmptyWorkspace);

      const result = await service.listTags('ws-empty');

      expect(result).toEqual([]);
    });
  });
});
