import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { BackfillService } from './backfill.service';
import { ClickHouseService } from '../../database/clickhouse.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { StartBackfillDto } from './dto/start-backfill.dto';
import { BackfillTask } from './backfill-task.entity';

describe('BackfillService', () => {
  let service: BackfillService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let workspacesService: jest.Mocked<WorkspacesService>;

  const mockWorkspace = {
    id: 'workspace-1',
    name: 'Test Workspace',
    website: 'https://test.com',
    timezone: 'UTC',
    currency: 'USD',
    status: 'active',
    custom_dimensions: [
      {
        id: 'cd-1',
        slot: 1,
        name: 'Channel',
        category: 'Custom',
        rules: [
          {
            conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
            outputValue: 'Google',
          },
        ],
        defaultValue: 'Other',
        version: 'abc12345',
        createdAt: '2025-01-01 00:00:00',
        updatedAt: '2025-01-01 00:00:00',
      },
    ],
  };

  const mockTask: BackfillTask = {
    id: 'task-1',
    workspace_id: 'workspace-1',
    status: 'running',
    lookback_days: 30,
    chunk_size_days: 1,
    batch_size: 5000,
    total_sessions: 1000,
    processed_sessions: 500,
    total_events: 5000,
    processed_events: 2500,
    current_date_chunk: '2025-12-01',
    created_at: '2025-12-29 10:00:00',
    started_at: '2025-12-29 10:00:01',
    completed_at: null,
    error_message: null,
    retry_count: 0,
    dimensions_snapshot: JSON.stringify(mockWorkspace.custom_dimensions),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackfillService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
            commandSystem: jest.fn(),
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BackfillService>(BackfillService);
    clickhouse = module.get(ClickHouseService);
    workspacesService = module.get(WorkspacesService);
  });

  describe('startBackfill', () => {
    const dto: StartBackfillDto = {
      workspace_id: 'workspace-1',
      lookback_days: 30,
    };

    it('should create task and return task_id', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace as any);
      clickhouse.querySystem.mockResolvedValue([]); // No running tasks
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.startBackfill(dto);

      expect(result).toHaveProperty('task_id');
      expect(typeof result.task_id).toBe('string');
      expect(result.task_id.length).toBeGreaterThan(0);
    });

    it('should reject if workspace not found', async () => {
      workspacesService.get.mockRejectedValue(new NotFoundException('Workspace not found'));

      await expect(service.startBackfill(dto)).rejects.toThrow(NotFoundException);
    });

    it('should reject if another task is running for workspace', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace as any);
      clickhouse.querySystem.mockResolvedValue([{ id: 'existing-task' }]); // Running task exists

      await expect(service.startBackfill(dto)).rejects.toThrow(ConflictException);
    });

    it('should snapshot current custom dimensions', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace as any);
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.startBackfill(dto);

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'backfill_tasks',
        expect.arrayContaining([
          expect.objectContaining({
            dimensions_snapshot: JSON.stringify(mockWorkspace.custom_dimensions),
          }),
        ]),
      );
    });

    it('should use default chunk_size_days and batch_size when not provided', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace as any);
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.startBackfill(dto);

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'backfill_tasks',
        expect.arrayContaining([
          expect.objectContaining({
            chunk_size_days: 1,
            batch_size: 5000,
          }),
        ]),
      );
    });

    it('should use provided chunk_size_days and batch_size', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace as any);
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const customDto: StartBackfillDto = {
        ...dto,
        chunk_size_days: 7,
        batch_size: 1000,
      };

      await service.startBackfill(customDto);

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'backfill_tasks',
        expect.arrayContaining([
          expect.objectContaining({
            chunk_size_days: 7,
            batch_size: 1000,
          }),
        ]),
      );
    });
  });

  describe('getTaskStatus', () => {
    it('should return task with progress percentage', async () => {
      clickhouse.querySystem.mockResolvedValue([mockTask]);

      const result = await service.getTaskStatus('task-1');

      expect(result).toHaveProperty('id', 'task-1');
      expect(result).toHaveProperty('status', 'running');
      expect(result).toHaveProperty('progress_percent');
      expect(result.progress_percent).toBeGreaterThanOrEqual(0);
      expect(result.progress_percent).toBeLessThanOrEqual(100);
    });

    it('should calculate progress based on sessions and events', async () => {
      const taskHalfDone: BackfillTask = {
        ...mockTask,
        total_sessions: 1000,
        processed_sessions: 500,
        total_events: 1000,
        processed_events: 500,
      };
      clickhouse.querySystem.mockResolvedValue([taskHalfDone]);

      const result = await service.getTaskStatus('task-1');

      // 50% sessions (weight 0.7) + 50% events (weight 0.3) = 50%
      expect(result.progress_percent).toBe(50);
    });

    it('should return 100% when completed', async () => {
      const completedTask: BackfillTask = {
        ...mockTask,
        status: 'completed',
        total_sessions: 1000,
        processed_sessions: 1000,
        total_events: 5000,
        processed_events: 5000,
      };
      clickhouse.querySystem.mockResolvedValue([completedTask]);

      const result = await service.getTaskStatus('task-1');

      expect(result.progress_percent).toBe(100);
    });

    it('should calculate estimated time remaining', async () => {
      const startedAt = new Date(Date.now() - 60000); // Started 60 seconds ago
      const taskInProgress: BackfillTask = {
        ...mockTask,
        started_at: startedAt.toISOString().replace('T', ' ').replace('Z', ''),
        total_sessions: 1000,
        processed_sessions: 500,
        total_events: 0,
        processed_events: 0,
      };
      clickhouse.querySystem.mockResolvedValue([taskInProgress]);

      const result = await service.getTaskStatus('task-1');

      expect(result).toHaveProperty('estimated_remaining_seconds');
      // 500 sessions in 60 seconds = ~8.33 sessions/sec
      // 500 remaining = ~60 seconds remaining
      expect(result.estimated_remaining_seconds).toBeGreaterThan(0);
    });

    it('should throw if task not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.getTaskStatus('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return null for estimated time when no progress yet', async () => {
      const notStarted: BackfillTask = {
        ...mockTask,
        started_at: null,
        processed_sessions: 0,
        processed_events: 0,
      };
      clickhouse.querySystem.mockResolvedValue([notStarted]);

      const result = await service.getTaskStatus('task-1');

      expect(result.estimated_remaining_seconds).toBeNull();
    });
  });

  describe('cancelTask', () => {
    it('should mark task as cancelled', async () => {
      clickhouse.querySystem.mockResolvedValue([mockTask]);
      clickhouse.commandSystem.mockResolvedValue(undefined);

      const result = await service.cancelTask('task-1');

      expect(result).toEqual({ success: true });
      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining("status = 'cancelled'"),
      );
    });

    it('should throw if task not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.cancelTask('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw if task is already completed', async () => {
      const completedTask: BackfillTask = {
        ...mockTask,
        status: 'completed',
      };
      clickhouse.querySystem.mockResolvedValue([completedTask]);

      await expect(service.cancelTask('task-1')).rejects.toThrow();
    });

    it('should throw if task is already cancelled', async () => {
      const cancelledTask: BackfillTask = {
        ...mockTask,
        status: 'cancelled',
      };
      clickhouse.querySystem.mockResolvedValue([cancelledTask]);

      await expect(service.cancelTask('task-1')).rejects.toThrow();
    });
  });

  describe('listTasks', () => {
    it('should return tasks for workspace', async () => {
      clickhouse.querySystem.mockResolvedValue([mockTask]);

      const result = await service.listTasks('workspace-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 'task-1');
      expect(result[0]).toHaveProperty('status', 'running');
      expect(result[0]).toHaveProperty('progress_percent');
    });

    it('should return empty array when no tasks', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.listTasks('workspace-1');

      expect(result).toEqual([]);
    });

    it('should order by created_at descending', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.listTasks('workspace-1');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Object),
      );
    });
  });
});
