import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ExportService } from './export.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { UserEventsQueryDto } from './dto/user-events-query.dto';

describe('ExportService', () => {
  let service: ExportService;
  let clickhouseService: jest.Mocked<ClickHouseService>;
  let workspacesService: jest.Mocked<WorkspacesService>;

  const mockWorkspace = {
    id: 'test-ws',
    name: 'Test Workspace',
    status: 'active',
    settings: {},
  };

  const createMockEvent = (overrides = {}) => ({
    id: 'event-1',
    session_id: 'sess-123',
    user_id: 'user-abc',
    name: 'screen_view',
    path: '/home',
    created_at: '2025-01-25 10:00:00.000',
    updated_at: '2025-01-25 10:05:00.000',
    referrer: 'https://google.com',
    referrer_domain: 'google.com',
    is_direct: false,
    landing_page: 'https://example.com/',
    landing_domain: 'example.com',
    landing_path: '/',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'test',
    utm_term: '',
    utm_content: '',
    utm_id: '',
    utm_id_from: '',
    channel: 'paid',
    channel_group: 'search',
    stm_1: 'dim1',
    stm_2: 'dim2',
    stm_3: '',
    stm_4: '',
    stm_5: '',
    stm_6: '',
    stm_7: '',
    stm_8: '',
    stm_9: '',
    stm_10: '',
    device: 'desktop',
    browser: 'Chrome',
    browser_type: 'chromium',
    os: 'macOS',
    country: 'US',
    region: 'CA',
    city: 'San Francisco',
    language: 'en-US',
    timezone: 'America/Los_Angeles',
    goal_name: '',
    goal_value: 0,
    goal_timestamp: null,
    page_number: 1,
    duration: 5000,
    max_scroll: 75,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        {
          provide: ClickHouseService,
          useValue: {
            queryWorkspace: jest.fn().mockResolvedValue([]),
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

    service = module.get<ExportService>(ExportService);
    clickhouseService = module.get(ClickHouseService);
    workspacesService = module.get(WorkspacesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserEvents', () => {
    it('validates workspace exists', async () => {
      workspacesService.get.mockRejectedValue(new Error('Not found'));

      const dto: UserEventsQueryDto = {
        workspace_id: 'invalid-ws',
      };

      await expect(service.getUserEvents(dto)).rejects.toThrow();
      expect(workspacesService.get).toHaveBeenCalledWith('invalid-ws');
    });

    it('queries events table (not sessions/pages/goals)', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('FROM events FINAL'),
        expect.any(Object),
      );
    });

    it('returns only rows where user_id IS NOT NULL', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('user_id IS NOT NULL'),
        expect.any(Object),
      );
    });

    it('uses since param for initial query', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('updated_at >='),
        expect.objectContaining({
          since: expect.any(String),
        }),
      );
    });

    it('uses cursor param for pagination', async () => {
      // Cursor format: base64 encoded { updated_at, id }
      const cursor = Buffer.from(
        JSON.stringify({
          updated_at: '2025-01-25 10:05:00.000',
          id: 'event-123',
        }),
      ).toString('base64');

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        cursor,
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('(updated_at, id) >'),
        expect.objectContaining({
          cursor_updated_at: '2025-01-25 10:05:00.000',
          cursor_id: 'event-123',
        }),
      );
    });

    it('filters by user_id when provided', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
        user_id: 'specific-user',
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('user_id = {user_id:String}'),
        expect.objectContaining({
          user_id: 'specific-user',
        }),
      );
    });

    it('returns has_more: true when more rows exist', async () => {
      const events = Array(101)
        .fill(null)
        .map((_, i) =>
          createMockEvent({
            id: `event-${i}`,
            updated_at: `2025-01-25 10:0${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}.000`,
          }),
        );

      clickhouseService.queryWorkspace.mockResolvedValue(events);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
        limit: 100,
      };

      const result = await service.getUserEvents(dto);

      expect(result.has_more).toBe(true);
      expect(result.data).toHaveLength(100); // Should return limit, not limit+1
    });

    it('returns has_more: false when no more rows', async () => {
      const events = Array(50)
        .fill(null)
        .map((_, i) =>
          createMockEvent({
            id: `event-${i}`,
            updated_at: `2025-01-25 10:00:${String(i).padStart(2, '0')}.000`,
          }),
        );

      clickhouseService.queryWorkspace.mockResolvedValue(events);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
        limit: 100,
      };

      const result = await service.getUserEvents(dto);

      expect(result.has_more).toBe(false);
      expect(result.data).toHaveLength(50);
    });

    it('returns next_cursor when has_more is true', async () => {
      const events = Array(101)
        .fill(null)
        .map((_, i) =>
          createMockEvent({
            id: `event-${i}`,
            updated_at: `2025-01-25 10:00:${String(i).padStart(2, '0')}.000`,
          }),
        );

      clickhouseService.queryWorkspace.mockResolvedValue(events);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
        limit: 100,
      };

      const result = await service.getUserEvents(dto);

      expect(result.next_cursor).not.toBeNull();
      // Decode and verify cursor
      const decoded = JSON.parse(
        Buffer.from(result.next_cursor!, 'base64').toString(),
      );
      expect(decoded).toHaveProperty('updated_at');
      expect(decoded).toHaveProperty('id');
    });

    it('returns next_cursor: null when has_more is false', async () => {
      const events = [createMockEvent()];
      clickhouseService.queryWorkspace.mockResolvedValue(events);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
        limit: 100,
      };

      const result = await service.getUserEvents(dto);

      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('orders results by (updated_at, id) ASC', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('ORDER BY updated_at ASC, id ASC'),
        expect.any(Object),
      );
    });

    it('returns both screen_view and goal events', async () => {
      const events = [
        createMockEvent({ id: 'event-1', name: 'screen_view' }),
        createMockEvent({ id: 'event-2', name: 'goal', goal_name: 'purchase' }),
      ];
      clickhouseService.queryWorkspace.mockResolvedValue(events);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      const result = await service.getUserEvents(dto);

      expect(result.data).toHaveLength(2);
      expect(result.data.map((e) => e.name)).toContain('screen_view');
      expect(result.data.map((e) => e.name)).toContain('goal');
    });

    it('returns all event fields (UTM, device, geo, dimensions, goal data)', async () => {
      const event = createMockEvent({
        name: 'goal',
        goal_name: 'purchase',
        goal_value: 99.99,
        goal_timestamp: '2025-01-25 10:05:00.000',
      });
      clickhouseService.queryWorkspace.mockResolvedValue([event]);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      const result = await service.getUserEvents(dto);

      expect(result.data[0]).toMatchObject({
        // Basic fields
        id: expect.any(String),
        session_id: expect.any(String),
        user_id: expect.any(String),
        name: 'goal',
        path: expect.any(String),
        // UTM
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'test',
        // Device
        device: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        // Geo
        country: 'US',
        region: 'CA',
        city: 'San Francisco',
        language: 'en-US',
        // Custom dimensions
        stm_1: 'dim1',
        stm_2: 'dim2',
        // Goal data
        goal_name: 'purchase',
        goal_value: 99.99,
      });
    });

    it('uses default limit of 100 when not specified', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('LIMIT 101'), // limit + 1 for has_more detection
        expect.any(Object),
      );
    });

    it('handles empty result set', async () => {
      clickhouseService.queryWorkspace.mockResolvedValue([]);

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        since: '2025-01-25T00:00:00Z',
      };

      const result = await service.getUserEvents(dto);

      expect(result.data).toHaveLength(0);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('ignores since param when cursor is provided', async () => {
      const cursor = Buffer.from(
        JSON.stringify({
          updated_at: '2025-01-25 10:05:00.000',
          id: 'event-123',
        }),
      ).toString('base64');

      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        cursor,
        since: '2025-01-01T00:00:00Z', // Should be ignored
      };

      await service.getUserEvents(dto);

      expect(clickhouseService.queryWorkspace).toHaveBeenCalledWith(
        'test-ws',
        expect.stringContaining('(updated_at, id) >'),
        expect.not.objectContaining({
          since: expect.any(String),
        }),
      );
    });

    it('throws error for invalid cursor format', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        cursor: 'invalid-cursor',
      };

      await expect(service.getUserEvents(dto)).rejects.toThrow();
    });

    it('requires either cursor or since parameter', async () => {
      const dto: UserEventsQueryDto = {
        workspace_id: 'test-ws',
        // Neither cursor nor since provided
      };

      await expect(service.getUserEvents(dto)).rejects.toThrow(
        'Either cursor or since parameter is required',
      );
    });
  });
});
