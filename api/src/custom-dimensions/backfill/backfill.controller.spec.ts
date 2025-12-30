import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { BackfillService } from './backfill.service';
import { CustomDimensionsController } from '../custom-dimensions.controller';
import { CustomDimensionsService } from '../custom-dimensions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BackfillTaskProgress } from './backfill-task.entity';

describe('Backfill Endpoints', () => {
  let app: INestApplication;
  let backfillService: jest.Mocked<BackfillService>;

  const mockTaskProgress: BackfillTaskProgress = {
    id: 'task-1',
    status: 'running',
    progress_percent: 50,
    sessions: { processed: 500, total: 1000 },
    events: { processed: 2500, total: 5000 },
    current_chunk: '2025-12-28',
    started_at: '2025-12-29 10:00:00',
    completed_at: null,
    error_message: null,
    estimated_remaining_seconds: 60,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomDimensionsController],
      providers: [
        {
          provide: CustomDimensionsService,
          useValue: {
            list: jest.fn(),
            get: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            test: jest.fn(),
          },
        },
        {
          provide: BackfillService,
          useValue: {
            startBackfill: jest.fn(),
            getTaskStatus: jest.fn(),
            cancelTask: jest.fn(),
            listTasks: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    backfillService = module.get(BackfillService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/customDimensions.backfillStart', () => {
    it('should return task_id', async () => {
      backfillService.startBackfill.mockResolvedValue({ task_id: 'task-123' });

      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .send({
          workspace_id: 'workspace-1',
          lookback_days: 30,
        })
        .expect(201);

      expect(response.body).toEqual({ task_id: 'task-123' });
      expect(backfillService.startBackfill).toHaveBeenCalledWith({
        workspace_id: 'workspace-1',
        lookback_days: 30,
      });
    });

    it('should accept optional chunk_size_days and batch_size', async () => {
      backfillService.startBackfill.mockResolvedValue({ task_id: 'task-123' });

      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .send({
          workspace_id: 'workspace-1',
          lookback_days: 30,
          chunk_size_days: 7,
          batch_size: 1000,
        })
        .expect(201);

      expect(backfillService.startBackfill).toHaveBeenCalledWith({
        workspace_id: 'workspace-1',
        lookback_days: 30,
        chunk_size_days: 7,
        batch_size: 1000,
      });
    });

    it('should validate lookback_days range', async () => {
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .send({
          workspace_id: 'workspace-1',
          lookback_days: 500, // Over max of 365
        })
        .expect(400);
    });

    it('should require workspace_id', async () => {
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .send({
          lookback_days: 30,
        })
        .expect(400);
    });
  });

  describe('GET /api/customDimensions.backfillStatus', () => {
    it('should return progress', async () => {
      backfillService.getTaskStatus.mockResolvedValue(mockTaskProgress);

      const response = await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .query({ task_id: 'task-1' })
        .expect(200);

      expect(response.body).toEqual(mockTaskProgress);
      expect(backfillService.getTaskStatus).toHaveBeenCalledWith('task-1');
    });

    it('should require task_id', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .expect(400);
    });
  });

  describe('POST /api/customDimensions.backfillCancel', () => {
    it('should stop task', async () => {
      backfillService.cancelTask.mockResolvedValue({ success: true });

      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillCancel')
        .query({ task_id: 'task-1' })
        .expect(201);

      expect(response.body).toEqual({ success: true });
      expect(backfillService.cancelTask).toHaveBeenCalledWith('task-1');
    });
  });

  describe('GET /api/customDimensions.backfillList', () => {
    it('should return workspace tasks', async () => {
      backfillService.listTasks.mockResolvedValue([mockTaskProgress]);

      const response = await request(app.getHttpServer())
        .get('/api/customDimensions.backfillList')
        .query({ workspace_id: 'workspace-1' })
        .expect(200);

      expect(response.body).toEqual([mockTaskProgress]);
      expect(backfillService.listTasks).toHaveBeenCalledWith('workspace-1');
    });

    it('should require workspace_id', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillList')
        .expect(400);
    });
  });
});
