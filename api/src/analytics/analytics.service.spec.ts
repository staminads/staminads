import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnalyticsService } from './analytics.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Workspace } from '../workspaces/entities/workspace.entity';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let cacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  const mockWorkspace: Workspace = {
    id: 'ws-1',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    status: 'active',
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
    settings: {
      timescore_reference: 180,
      bounce_threshold: 10,
      custom_dimensions: {},
      filters: [],
      integrations: [],
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
    },
  };

  const mockQueryResult = [
    { date_day: '2025-01-01', sessions: 100 },
    { date_day: '2025-01-02', sessions: 150 },
  ];

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: ClickHouseService,
          useValue: {
            queryWorkspace: jest.fn().mockResolvedValue(mockQueryResult),
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn().mockResolvedValue(mockWorkspace),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    workspacesService = module.get(WorkspacesService);
    clickhouse = module.get(ClickHouseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('query caching', () => {
    const baseQuery = {
      workspace_id: 'ws-1',
      metrics: ['sessions'],
      dateRange: {
        start: '2025-01-01 00:00:00',
        end: '2025-01-02 23:59:59',
        granularity: 'day' as const,
      },
    };

    it('returns cached result on cache hit', async () => {
      const cachedResult = {
        data: mockQueryResult,
        meta: { metrics: ['sessions'], dimensions: [], total_rows: 2 },
      };
      cacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.query(baseQuery);

      expect(result).toEqual(cachedResult);
      expect(clickhouse.queryWorkspace).not.toHaveBeenCalled();
      expect(cacheManager.set).not.toHaveBeenCalled();
    });

    it('executes query and caches result on cache miss', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      const result = await service.query(baseQuery);

      expect(clickhouse.queryWorkspace).toHaveBeenCalled();
      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.stringMatching(/^analytics:ws-1:/),
        expect.objectContaining({ data: expect.any(Array) }),
        expect.any(Number),
      );
      expect(result.data).toBeDefined();
    });

    it('uses 5 min TTL for historical queries', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      // Query with dates in the past
      await service.query({
        ...baseQuery,
        dateRange: {
          start: '2024-01-01 00:00:00',
          end: '2024-01-02 23:59:59',
          granularity: 'day',
        },
      });

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        5 * 60 * 1000, // 5 minutes
      );
    });

    it('uses 1 min TTL for queries including today', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      // Query with end date as today
      const today = new Date().toISOString().split('T')[0];
      await service.query({
        ...baseQuery,
        dateRange: {
          start: '2025-01-01 00:00:00',
          end: `${today} 23:59:59`,
          granularity: 'day',
        },
      });

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        60 * 1000, // 1 minute
      );
    });

    it('generates different cache keys for different queries', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      await service.query(baseQuery);
      const firstCacheKey = cacheManager.set.mock.calls[0][0];

      await service.query({
        ...baseQuery,
        metrics: ['sessions', 'avg_duration'],
      });
      const secondCacheKey = cacheManager.set.mock.calls[1][0];

      expect(firstCacheKey).not.toEqual(secondCacheKey);
    });

    it('generates same cache key for equivalent queries', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      await service.query(baseQuery);
      const firstCacheKey = cacheManager.set.mock.calls[0][0];

      cacheManager.set.mockClear();
      cacheManager.get.mockResolvedValue(undefined);

      await service.query(baseQuery);
      const secondCacheKey = cacheManager.set.mock.calls[0][0];

      expect(firstCacheKey).toEqual(secondCacheKey);
    });
  });

  describe('query deduplication', () => {
    const baseQuery = {
      workspace_id: 'ws-1',
      metrics: ['sessions'],
      dateRange: {
        start: '2025-01-01 00:00:00',
        end: '2025-01-02 23:59:59',
        granularity: 'day' as const,
      },
    };

    it('deduplicates concurrent identical requests', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      // Simulate slow query
      let resolveQuery: (value: unknown) => void;
      const slowQueryPromise = new Promise((resolve) => {
        resolveQuery = resolve;
      });
      clickhouse.queryWorkspace.mockReturnValue(slowQueryPromise as any);

      // Start two concurrent queries
      const promise1 = service.query(baseQuery);
      const promise2 = service.query(baseQuery);

      // Resolve the slow query
      resolveQuery!(mockQueryResult);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should return the same result
      expect(result1).toEqual(result2);
      // Only one actual DB query should be made
      expect(clickhouse.queryWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache invalidation', () => {
    const baseQuery = {
      workspace_id: 'ws-1',
      metrics: ['sessions'],
      dateRange: {
        start: '2025-01-01 00:00:00',
        end: '2025-01-02 23:59:59',
        granularity: 'day' as const,
      },
    };

    it('clears workspace cache on backfill.completed event', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      // First, create some cached queries
      await service.query(baseQuery);
      await service.query({
        ...baseQuery,
        metrics: ['avg_duration'],
      });

      // Trigger backfill completed event
      await service.handleBackfillCompleted({ workspaceId: 'ws-1' });

      // Should have deleted the cached keys
      expect(cacheManager.del).toHaveBeenCalledTimes(2);
    });

    it('does not clear cache for other workspaces', async () => {
      cacheManager.get.mockResolvedValue(undefined);

      // Create cached query for ws-1
      await service.query(baseQuery);

      // Trigger backfill for different workspace
      await service.handleBackfillCompleted({ workspaceId: 'ws-2' });

      // Should not delete any keys
      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });
});
