import { Test, TestingModule } from '@nestjs/testing';
import { EventBufferService } from './event-buffer.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { TrackingEvent } from './entities/event.entity';

describe('EventBufferService', () => {
  let service: EventBufferService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  const createEvent = (workspaceId: string, sessionId: string): TrackingEvent => ({
    workspace_id: workspaceId,
    session_id: sessionId,
    name: 'screen_view',
    path: '/test',
    created_at: '2025-01-01 00:00:00',
    duration: 0,
    referrer: '',
    referrer_domain: '',
    referrer_path: '',
    is_direct: true,
    landing_page: 'https://example.com',
    landing_domain: 'example.com',
    landing_path: '/',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
    utm_id: '',
    utm_id_from: '',
    screen_width: 0,
    screen_height: 0,
    viewport_width: 0,
    viewport_height: 0,
    device: '',
    browser: '',
    browser_type: '',
    os: '',
    user_agent: '',
    connection_type: '',
    language: '',
    timezone: '',
    country: '',
    region: '',
    city: '',
    latitude: null,
    longitude: null,
    max_scroll: 0,
    sdk_version: '',
    properties: {},
    channel: '',
    channel_group: '',
    cd_1: '',
    cd_2: '',
    cd_3: '',
    cd_4: '',
    cd_5: '',
    cd_6: '',
    cd_7: '',
    cd_8: '',
    cd_9: '',
    cd_10: '',
  });

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBufferService,
        {
          provide: ClickHouseService,
          useValue: {
            insertWorkspace: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventBufferService>(EventBufferService);
    clickhouse = module.get(ClickHouseService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
    await service.onModuleDestroy();
  });

  describe('add', () => {
    it('adds event to buffer', async () => {
      const event = createEvent('ws-1', 'session-1');
      await service.add(event);

      expect(service.getBufferSize('ws-1')).toBe(1);
    });

    it('adds events to separate workspace buffers', async () => {
      const event1 = createEvent('ws-1', 'session-1');
      const event2 = createEvent('ws-2', 'session-2');

      await service.add(event1);
      await service.add(event2);

      expect(service.getBufferSize('ws-1')).toBe(1);
      expect(service.getBufferSize('ws-2')).toBe(1);
      expect(service.getBufferSize()).toBe(2);
    });

    it('flushes automatically when buffer reaches max size', async () => {
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      // Add 500 events (MAX_BUFFER_SIZE)
      for (let i = 0; i < 500; i++) {
        await service.add(createEvent('ws-1', `session-${i}`));
      }

      // Should have triggered a flush
      expect(clickhouse.insertWorkspace).toHaveBeenCalledWith(
        'ws-1',
        'events',
        expect.any(Array),
      );
      expect(service.getBufferSize('ws-1')).toBe(0);
    });

    it('starts flush timer on first event', async () => {
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      const event = createEvent('ws-1', 'session-1');
      await service.add(event);

      expect(service.getBufferSize('ws-1')).toBe(1);

      // Fast-forward timer
      jest.advanceTimersByTime(2000);
      await Promise.resolve(); // Let microtasks run

      // Buffer should be flushed after timer
      expect(clickhouse.insertWorkspace).toHaveBeenCalled();
    });
  });

  describe('addBatch', () => {
    it('adds batch of events grouped by workspace', async () => {
      const events = [
        createEvent('ws-1', 'session-1'),
        createEvent('ws-1', 'session-2'),
        createEvent('ws-2', 'session-3'),
      ];

      await service.addBatch(events);

      expect(service.getBufferSize('ws-1')).toBe(2);
      expect(service.getBufferSize('ws-2')).toBe(1);
    });

    it('handles empty batch', async () => {
      await service.addBatch([]);

      expect(service.getBufferSize()).toBe(0);
    });
  });

  describe('flush', () => {
    it('flushes buffer for specific workspace', async () => {
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-1', 'session-2'));

      await service.flush('ws-1');

      expect(clickhouse.insertWorkspace).toHaveBeenCalledWith(
        'ws-1',
        'events',
        expect.arrayContaining([
          expect.objectContaining({ session_id: 'session-1' }),
          expect.objectContaining({ session_id: 'session-2' }),
        ]),
      );
      expect(service.getBufferSize('ws-1')).toBe(0);
    });

    it('does nothing for empty buffer', async () => {
      await service.flush('ws-nonexistent');

      expect(clickhouse.insertWorkspace).not.toHaveBeenCalled();
    });

    it('re-adds events on flush failure', async () => {
      // First add succeeds (so we can add events), then flush fails
      clickhouse.insertWorkspace.mockRejectedValueOnce(new Error('DB error'));

      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-1', 'session-2'));

      await expect(service.flush('ws-1')).rejects.toThrow('DB error');

      // Events should be re-added to buffer
      expect(service.getBufferSize('ws-1')).toBe(2);
    });

    it('prevents concurrent flushes for same workspace', async () => {
      let resolveInsert: () => void;
      clickhouse.insertWorkspace.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveInsert = resolve as () => void;
          }),
      );

      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-1', 'session-2'));

      // Start first flush
      const flush1 = service.flush('ws-1');

      // Try to start second flush
      const flush2 = service.flush('ws-1');

      // Resolve first flush
      resolveInsert!();
      await flush1;
      await flush2;

      // Should only have one insert call
      expect(clickhouse.insertWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushAll', () => {
    it('flushes all workspace buffers', async () => {
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-2', 'session-2'));
      await service.add(createEvent('ws-3', 'session-3'));

      await service.flushAll();

      expect(clickhouse.insertWorkspace).toHaveBeenCalledTimes(3);
      expect(service.getBufferSize()).toBe(0);
    });
  });

  describe('getBufferSize', () => {
    it('returns 0 for unknown workspace', () => {
      expect(service.getBufferSize('unknown')).toBe(0);
    });

    it('returns total size when no workspace specified', async () => {
      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-1', 'session-2'));
      await service.add(createEvent('ws-2', 'session-3'));

      expect(service.getBufferSize()).toBe(3);
    });

    it('returns workspace-specific size', async () => {
      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-1', 'session-2'));
      await service.add(createEvent('ws-2', 'session-3'));

      expect(service.getBufferSize('ws-1')).toBe(2);
      expect(service.getBufferSize('ws-2')).toBe(1);
    });
  });

  describe('onModuleDestroy', () => {
    it('flushes all buffers on shutdown', async () => {
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      await service.add(createEvent('ws-1', 'session-1'));
      await service.add(createEvent('ws-2', 'session-2'));

      await service.onModuleDestroy();

      expect(clickhouse.insertWorkspace).toHaveBeenCalledTimes(2);
      expect(service.getBufferSize()).toBe(0);
    });
  });
});
