import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { Subscription } from './entities/subscription.entity';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let workspacesService: jest.Mocked<WorkspacesService>;

  const mockWorkspace = {
    id: 'ws-123',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'America/New_York',
    currency: 'USD',
    status: 'active',
    settings: '{}',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  const mockSubscription: Subscription = {
    id: 'sub-123',
    user_id: 'user-123',
    workspace_id: 'ws-123',
    name: 'Daily Report',
    frequency: 'daily',
    hour: 8,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['landing_path', 'device'],
    filters: '[]',
    status: 'active',
    last_send_status: 'pending',
    last_error: '',
    consecutive_failures: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn().mockResolvedValue(mockWorkspace),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    clickhouse = module.get(ClickHouseService);
    workspacesService = module.get(WorkspacesService);
  });

  describe('create', () => {
    const createDto: CreateSubscriptionDto = {
      workspace_id: 'ws-123',
      name: 'Daily Report',
      frequency: 'daily',
      hour: 8,
      metrics: ['sessions', 'median_duration'],
      dimensions: ['landing_path', 'device'],
      filters: [],
    };

    it('should create a subscription with valid data', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(createDto, 'user-123');

      expect(result).toMatchObject({
        user_id: 'user-123',
        workspace_id: 'ws-123',
        name: 'Daily Report',
        frequency: 'daily',
        status: 'active',
      });
      expect(result.id).toBeDefined();
      expect(clickhouse.insertSystem).toHaveBeenCalled();
    });

    it('should calculate next_send_at for daily frequency', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(createDto, 'user-123');

      expect(result.next_send_at).toBeDefined();
      // next_send_at should be in the future
      expect(new Date(result.next_send_at!).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('should calculate next_send_at for weekly frequency', async () => {
      const weeklyDto: CreateSubscriptionDto = {
        ...createDto,
        frequency: 'weekly',
        day_of_week: 1, // Monday
      };
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(weeklyDto, 'user-123');

      expect(result.next_send_at).toBeDefined();
      expect(result.day_of_week).toBe(1);
    });

    it('should calculate next_send_at for monthly frequency', async () => {
      const monthlyDto: CreateSubscriptionDto = {
        ...createDto,
        frequency: 'monthly',
        day_of_month: 15,
      };
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(monthlyDto, 'user-123');

      expect(result.next_send_at).toBeDefined();
      expect(result.day_of_month).toBe(15);
    });

    it('should store filters as JSON string', async () => {
      const dtoWithFilters: CreateSubscriptionDto = {
        ...createDto,
        filters: [{ dimension: 'country', operator: 'equals', values: ['US'] }],
      };
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(dtoWithFilters, 'user-123');

      expect(result.filters).toBe(
        JSON.stringify([
          { dimension: 'country', operator: 'equals', values: ['US'] },
        ]),
      );
    });

    it('should default hour to 8 if not provided', async () => {
      const dtoWithoutHour: CreateSubscriptionDto = {
        workspace_id: 'ws-123',
        name: 'Daily Report',
        frequency: 'daily',
        metrics: ['sessions'],
      };
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(dtoWithoutHour, 'user-123');

      expect(result.hour).toBe(8);
    });
  });

  describe('list', () => {
    it('should return only subscriptions for the given user and workspace', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);

      const result = await service.list('ws-123', 'user-123');

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe('user-123');
      expect(result[0].workspace_id).toBe('ws-123');
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('user_id'),
        expect.objectContaining({
          user_id: 'user-123',
          workspace_id: 'ws-123',
        }),
      );
    });

    it('should return empty array when no subscriptions exist', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.list('ws-123', 'user-123');

      expect(result).toEqual([]);
    });

    it('should not return disabled subscriptions', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.list('ws-123', 'user-123');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining("status != 'disabled'"),
        expect.any(Object),
      );
    });
  });

  describe('get', () => {
    it('should return subscription by id', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);

      const result = await service.get('sub-123', 'user-123');

      expect(result).toMatchObject(mockSubscription);
    });

    it('should return null if subscription not found', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.get('non-existent', 'user-123');

      expect(result).toBeNull();
    });

    it('should not return subscription if user is not owner', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.get('sub-123', 'other-user');

      expect(result).toBeNull();
    });
  });

  describe('pause', () => {
    it('should set status to paused', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.pause('sub-123', 'user-123');

      expect(result.status).toBe('paused');
    });

    it('should clear next_send_at when paused', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.pause('sub-123', 'user-123');

      expect(result.next_send_at).toBeUndefined();
    });
  });

  describe('resume', () => {
    it('should set status to active on resume', async () => {
      const pausedSubscription = {
        ...mockSubscription,
        status: 'paused' as const,
      };
      clickhouse.querySystem.mockResolvedValue([pausedSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.resume('sub-123', 'user-123');

      expect(result.status).toBe('active');
    });

    it('should recalculate next_send_at on resume', async () => {
      const pausedSubscription = {
        ...mockSubscription,
        status: 'paused' as const,
      };
      clickhouse.querySystem.mockResolvedValue([pausedSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.resume('sub-123', 'user-123');

      expect(result.next_send_at).toBeDefined();
      expect(new Date(result.next_send_at!).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe('delete', () => {
    it('should set status to disabled (soft delete)', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.delete('sub-123', 'user-123');

      expect(clickhouse.insertSystem).toHaveBeenCalled();
      const insertCall = clickhouse.insertSystem.mock.calls[0];
      expect(insertCall[1][0].status).toBe('disabled');
    });
  });

  describe('findDue', () => {
    it('should return subscriptions where next_send_at <= now and status = active', async () => {
      const dueSubscription = {
        ...mockSubscription,
        next_send_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
      };
      clickhouse.querySystem.mockResolvedValue([dueSubscription]);

      const result = await service.findDue();

      expect(result).toHaveLength(1);
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('next_send_at <='),
        expect.any(Object),
      );
    });

    it('should not return paused or disabled subscriptions', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.findDue();

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining("status = 'active'"),
        expect.any(Object),
      );
    });
  });

  describe('markSent', () => {
    it('should update last_sent_at to now', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markSent('sub-123');

      expect(result.last_sent_at).toBeDefined();
      // Verify it's a valid datetime string (format: YYYY-MM-DD HH:mm:ss.SSS)
      expect(result.last_sent_at).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/,
      );
    });

    it('should set last_send_status to success', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markSent('sub-123');

      expect(result.last_send_status).toBe('success');
    });

    it('should reset consecutive_failures to 0', async () => {
      const subscriptionWithFailures = {
        ...mockSubscription,
        consecutive_failures: 3,
      };
      clickhouse.querySystem.mockResolvedValue([subscriptionWithFailures]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markSent('sub-123');

      expect(result.consecutive_failures).toBe(0);
    });

    it('should calculate new next_send_at', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markSent('sub-123');

      expect(result.next_send_at).toBeDefined();
      expect(new Date(result.next_send_at!).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe('markFailed', () => {
    it('should increment consecutive_failures', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markFailed('sub-123', 'SMTP error');

      expect(result.consecutive_failures).toBe(1);
    });

    it('should set last_send_status to failed', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markFailed('sub-123', 'SMTP error');

      expect(result.last_send_status).toBe('failed');
    });

    it('should store error message in last_error', async () => {
      clickhouse.querySystem.mockResolvedValue([mockSubscription]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markFailed(
        'sub-123',
        'SMTP connection refused',
      );

      expect(result.last_error).toBe('SMTP connection refused');
    });

    it('should set status to disabled after 5 failures', async () => {
      const subscriptionWith4Failures = {
        ...mockSubscription,
        consecutive_failures: 4,
      };
      clickhouse.querySystem.mockResolvedValue([subscriptionWith4Failures]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markFailed('sub-123', 'SMTP error');

      expect(result.consecutive_failures).toBe(5);
      expect(result.status).toBe('disabled');
    });

    it('should not disable if fewer than 5 consecutive failures', async () => {
      const subscriptionWith3Failures = {
        ...mockSubscription,
        consecutive_failures: 3,
      };
      clickhouse.querySystem.mockResolvedValue([subscriptionWith3Failures]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.markFailed('sub-123', 'SMTP error');

      expect(result.consecutive_failures).toBe(4);
      expect(result.status).toBe('active');
    });
  });
});
