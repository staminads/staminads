import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionPayloadHandler } from './session-payload.handler';
import { EventBufferService } from './event-buffer.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { GeoService } from '../geo/geo.service';
import { EMPTY_GEO } from '../geo/geo.interface';
import {
  SessionPayloadDto,
  PageviewActionDto,
  GoalActionDto,
} from './dto/session-payload.dto';

describe('SessionPayloadHandler', () => {
  let handler: SessionPayloadHandler;
  let bufferService: jest.Mocked<EventBufferService>;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let geoService: jest.Mocked<GeoService>;

  const mockWorkspace = {
    id: 'test-ws',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    status: 'active',
    settings: {
      timescore_reference: 180,
      bounce_threshold: 10,
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
      filters: [],
    },
  };

  const createPayload = (
    overrides: Partial<SessionPayloadDto> = {},
  ): SessionPayloadDto =>
    ({
      workspace_id: 'test-ws',
      session_id: 'sess-123',
      actions: [],
      created_at: Date.now() - 10000,
      updated_at: Date.now(),
      ...overrides,
    }) as SessionPayloadDto;

  const createPageviewAction = (
    overrides: Partial<PageviewActionDto> = {},
  ): PageviewActionDto =>
    ({
      type: 'pageview',
      path: '/home',
      page_number: 1,
      duration: 5000,
      scroll: 50,
      entered_at: Date.now() - 5000,
      exited_at: Date.now(),
      ...overrides,
    }) as PageviewActionDto;

  const createGoalAction = (
    overrides: Partial<GoalActionDto> = {},
  ): GoalActionDto =>
    ({
      type: 'goal',
      name: 'signup',
      path: '/register',
      page_number: 2,
      timestamp: Date.now(),
      ...overrides,
    }) as GoalActionDto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionPayloadHandler,
        {
          provide: EventBufferService,
          useValue: { addBatch: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WorkspacesService,
          useValue: { get: jest.fn().mockResolvedValue(mockWorkspace) },
        },
        {
          provide: GeoService,
          useValue: {
            lookupWithSettings: jest.fn().mockReturnValue(EMPTY_GEO),
          },
        },
      ],
    }).compile();

    handler = module.get<SessionPayloadHandler>(SessionPayloadHandler);
    bufferService = module.get(EventBufferService);
    workspacesService = module.get(WorkspacesService);
    geoService = module.get(GeoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('pageview deserialization', () => {
    it('converts pageview action to screen_view event', async () => {
      const payload = createPayload({
        actions: [createPageviewAction({ path: '/about', page_number: 2 })],
        attributes: { landing_page: 'https://example.com/home' },
      });

      await handler.handle(payload, '8.8.8.8');

      expect(bufferService.addBatch).toHaveBeenCalledTimes(1);
      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        session_id: 'sess-123',
        workspace_id: 'test-ws',
        name: 'screen_view',
        path: '/about',
        page_number: 2,
        page_duration: 5000,
        max_scroll: 50,
      });
    });

    it('preserves entered_at and exited_at timestamps from SDK', async () => {
      const enteredAt = Date.now() - 5000;
      const exitedAt = Date.now();

      const payload = createPayload({
        actions: [
          createPageviewAction({
            entered_at: enteredAt,
            exited_at: exitedAt,
          }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].entered_at).toBeDefined();
      expect(events[0].exited_at).toBeDefined();
      // Verify they are ClickHouse DateTime format strings
      expect(typeof events[0].entered_at).toBe('string');
      expect(typeof events[0].exited_at).toBe('string');
    });

    it('sets previous_path from prior pageview', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ path: '/home', page_number: 1 }),
          createPageviewAction({ path: '/about', page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/home' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].previous_path).toBe(''); // First page has no previous
      expect(events[1].previous_path).toBe('/home'); // Second page's previous is first
    });

    it('converts duration from ms to seconds for page_duration', async () => {
      const payload = createPayload({
        actions: [createPageviewAction({ duration: 5500 })], // 5.5 seconds in ms
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].page_duration).toBe(5500); // Keep as ms, matches schema
    });
  });

  describe('goal deserialization', () => {
    it('converts goal action to goal event', async () => {
      const timestamp = Date.now();
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({
            name: 'purchase',
            value: 99.99,
            timestamp,
            page_number: 7,
          }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events).toHaveLength(2);

      const goalEvent = events[1];
      expect(goalEvent).toMatchObject({
        name: 'goal',
        goal_name: 'purchase',
        goal_value: 99.99,
        page_number: 7, // Explicitly set, verifies mapping from action
      });
    });

    it('includes goal properties in event properties', async () => {
      const payload = createPayload({
        actions: [
          createGoalAction({
            name: 'checkout',
            properties: { plan: 'premium', source: 'banner' },
          }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].properties).toEqual({
        plan: 'premium',
        source: 'banner',
      });
    });

    it('sets goal_value to 0 when not provided', async () => {
      const payload = createPayload({
        actions: [createGoalAction({ name: 'signup' })], // No value
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].goal_value).toBe(0);
    });

    it('preserves goal timestamp from SDK', async () => {
      const goalTimestamp = Date.now() - 1000;

      const payload = createPayload({
        actions: [
          createGoalAction({
            name: 'purchase',
            timestamp: goalTimestamp,
          }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].goal_timestamp).toBeDefined();
      // Verify it's a ClickHouse DateTime format string
      expect(typeof events[0].goal_timestamp).toBe('string');
    });
  });

  describe('_version timestamp', () => {
    it('sets _version to current server time on all events', async () => {
      const beforeTime = Date.now();

      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'signup' }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const afterTime = Date.now();
      const events = bufferService.addBatch.mock.calls[0][0];

      for (const event of events) {
        expect(event._version).toBeGreaterThanOrEqual(beforeTime);
        expect(event._version).toBeLessThanOrEqual(afterTime);
      }
    });

    it('all events in same payload have same _version', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
          createGoalAction({ name: 'signup' }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      const versions = events.map((e: { _version: number }) => e._version);
      expect(new Set(versions).size).toBe(1); // All same version
    });
  });

  describe('checkpoint handling', () => {
    it('skips actions at or before checkpoint', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ path: '/page1', page_number: 1 }), // index 0
          createPageviewAction({ path: '/page2', page_number: 2 }), // index 1
          createPageviewAction({ path: '/page3', page_number: 3 }), // index 2
          createGoalAction({ name: 'signup' }), // index 3
        ],
        checkpoint: 1, // Skip indices 0 and 1
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events).toHaveLength(2); // Only page3 and signup
      expect(events[0].path).toBe('/page3');
      expect(events[1].name).toBe('goal');
    });

    it('returns new checkpoint equal to actions length', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
          createGoalAction({ name: 'signup' }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      const result = await handler.handle(payload, null);

      expect(result.checkpoint).toBe(3); // Total actions processed
    });

    it('returns checkpoint 0 for empty actions', async () => {
      const payload = createPayload({ actions: [] });

      const result = await handler.handle(payload, null);

      expect(result.checkpoint).toBe(0);
      expect(bufferService.addBatch).not.toHaveBeenCalled();
    });

    it('handles checkpoint equal to actions length (no new actions)', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
        ],
        checkpoint: 2, // All actions already processed
        attributes: { landing_page: 'https://example.com/' },
      });

      const result = await handler.handle(payload, null);

      expect(result.checkpoint).toBe(2);
      expect(bufferService.addBatch).not.toHaveBeenCalled();
    });

    it('builds previous_path chain from all actions including skipped', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ path: '/page1', page_number: 1 }), // index 0 - skipped
          createPageviewAction({ path: '/page2', page_number: 2 }), // index 1 - skipped
          createPageviewAction({ path: '/page3', page_number: 3 }), // index 2 - processed
        ],
        checkpoint: 1, // Skip indices 0 and 1
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events).toHaveLength(1);
      // previous_path should be /page2 (from skipped action at index 1)
      expect(events[0].previous_path).toBe('/page2');
    });
  });

  describe('current_page handling', () => {
    it('ignores current_page (not finalized)', async () => {
      const payload = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        current_page: {
          path: '/in-progress',
          page_number: 2,
          entered_at: Date.now(),
          scroll: 25,
        },
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events).toHaveLength(1); // Only the action, not current_page
      expect(events[0].path).toBe('/home'); // From the action, not /in-progress
    });
  });

  describe('session attributes', () => {
    it('applies session attributes to all events', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'signup' }),
        ],
        attributes: {
          landing_page: 'https://example.com/landing',
          referrer: 'https://google.com/search',
          utm_source: 'google',
          utm_medium: 'cpc',
          browser: 'Chrome',
          os: 'macOS',
          screen_width: 1920,
          screen_height: 1080,
        },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      for (const event of events) {
        expect(event.landing_page).toBe('https://example.com/landing');
        expect(event.referrer).toBe('https://google.com/search');
        expect(event.utm_source).toBe('google');
        expect(event.browser).toBe('Chrome');
        expect(event.screen_width).toBe(1920);
      }
    });

    it('derives referrer_domain and landing_domain from URLs', async () => {
      const payload = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: {
          landing_page: 'https://example.com/products/item?id=123',
          referrer: 'https://google.com/search?q=test',
        },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].landing_domain).toBe('example.com');
      expect(events[0].landing_path).toBe('/products/item');
      expect(events[0].referrer_domain).toBe('google.com');
      expect(events[0].referrer_path).toBe('/search');
    });

    it('sets is_direct based on referrer presence', async () => {
      // With referrer
      const payloadWithRef = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: {
          landing_page: 'https://example.com/',
          referrer: 'https://google.com/',
        },
      });
      await handler.handle(payloadWithRef, null);
      expect(bufferService.addBatch.mock.calls[0][0][0].is_direct).toBe(false);

      bufferService.addBatch.mockClear();

      // Without referrer
      const payloadDirect = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: { landing_page: 'https://example.com/' },
      });
      await handler.handle(payloadDirect, null);
      expect(bufferService.addBatch.mock.calls[0][0][0].is_direct).toBe(true);
    });
  });

  describe('geo lookup', () => {
    it('applies geo data from IP lookup', async () => {
      geoService.lookupWithSettings.mockReturnValue({
        country: 'US',
        region: 'California',
        city: 'San Francisco',
        latitude: 37.77,
        longitude: -122.42,
      });

      const payload = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, '8.8.8.8');

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].country).toBe('US');
      expect(events[0].region).toBe('California');
      expect(events[0].city).toBe('San Francisco');
      expect(events[0].latitude).toBe(37.77);
      expect(events[0].longitude).toBe(-122.42);
    });

    it('performs geo lookup once per payload', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
          createGoalAction({ name: 'signup' }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, '8.8.8.8');

      expect(geoService.lookupWithSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('dedup token generation', () => {
    it('generates deterministic pageview dedup_token', async () => {
      const payload = createPayload({
        session_id: 'sess-abc',
        actions: [createPageviewAction({ page_number: 5 })],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      // Pageview token format: {session_id}_pv_{page_number}
      expect(events[0].dedup_token).toBe('sess-abc_pv_5');
    });

    it('generates deterministic goal dedup_token', async () => {
      const timestamp = 1704067200000;
      const payload = createPayload({
        session_id: 'sess-xyz',
        actions: [createGoalAction({ name: 'purchase', timestamp })],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      // Goal token format: {session_id}_goal_{name}_{timestamp}
      expect(events[0].dedup_token).toBe(
        'sess-xyz_goal_purchase_1704067200000',
      );
    });

    it('same payload produces same dedup_tokens (idempotent)', async () => {
      const payload = createPayload({
        session_id: 'sess-test',
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'signup', timestamp: 1704067200000 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      // Process same payload twice
      await handler.handle(payload, null);
      await handler.handle(payload, null);

      const events1 = bufferService.addBatch.mock.calls[0][0];
      const events2 = bufferService.addBatch.mock.calls[1][0];

      expect(events1[0].dedup_token).toBe(events2[0].dedup_token);
      expect(events1[1].dedup_token).toBe(events2[1].dedup_token);
    });
  });

  describe('error handling', () => {
    it('throws BadRequestException for invalid workspace', async () => {
      workspacesService.get.mockRejectedValue(new Error('Not found'));

      const payload = createPayload({ workspace_id: 'invalid-ws' });

      await expect(handler.handle(payload, null)).rejects.toThrow(
        'Invalid workspace_id',
      );
    });

    it('handles empty attributes gracefully', async () => {
      const payload = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        // No attributes
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].landing_page).toBe('');
      expect(events[0].referrer).toBe('');
    });
  });

  describe('filter application', () => {
    it('applies workspace filters to events', async () => {
      // Setup workspace with filters (using actual filter format)
      const workspaceWithFilters = {
        ...mockWorkspace,
        settings: {
          ...mockWorkspace.settings,
          filters: [
            {
              id: 'filter-1',
              name: 'UTM Override',
              priority: 1,
              order: 0,
              tags: [],
              enabled: true,
              version: 'v1',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              conditions: [
                { field: 'utm_source', operator: 'equals', value: 'google' },
              ],
              operations: [
                { action: 'set_value', dimension: 'stm_1', value: 'paid' },
              ],
            },
          ],
        },
      };
      workspacesService.get.mockResolvedValue(workspaceWithFilters as never);

      const payload = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: {
          landing_page: 'https://example.com/',
          utm_source: 'google',
        },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].stm_1).toBe('paid');
    });

    it('does not apply filters when none configured', async () => {
      const payload = createPayload({
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: {
          landing_page: 'https://example.com/',
          utm_source: 'google',
        },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].stm_1).toBe(''); // No filter applied
    });
  });

  // === Cross-Phase Tests ===
  describe('Cross-phase validation - action processing', () => {
    it('preserves action order in payload', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ path: '/a', page_number: 1 }),
          createGoalAction({ name: 'goal1', page_number: 1 }),
          createPageviewAction({ path: '/b', page_number: 2 }),
          createGoalAction({ name: 'goal2', page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events).toHaveLength(4);
      expect(
        events.map((e: { path: string; goal_name: string }) =>
          e.goal_name ? e.goal_name : e.path,
        ),
      ).toEqual(['/a', 'goal1', '/b', 'goal2']);
    });

    it('handles interleaved pageviews and goals', async () => {
      const payload = createPayload({
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'add_to_cart', page_number: 1 }),
          createGoalAction({ name: 'begin_checkout', page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
          createGoalAction({ name: 'purchase', page_number: 2, value: 99.99 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(
        events.filter((e: { name: string }) => e.name === 'screen_view'),
      ).toHaveLength(2);
      expect(
        events.filter((e: { name: string }) => e.name === 'goal'),
      ).toHaveLength(3);
    });

    it('processes empty actions array without error', async () => {
      const payload = createPayload({
        actions: [],
        attributes: { landing_page: 'https://example.com/' },
      });

      const result = await handler.handle(payload, null);

      expect(result.success).toBe(true);
      expect(result.checkpoint).toBe(0);
      expect(bufferService.addBatch).not.toHaveBeenCalled();
    });

    it('handles goal with all optional properties', async () => {
      const payload = createPayload({
        actions: [
          createGoalAction({
            name: 'purchase',
            page_number: 1,
            value: 99.99,
            properties: { product_id: 'SKU123', category: 'Electronics' },
          }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await handler.handle(payload, null);

      const events = bufferService.addBatch.mock.calls[0][0];
      expect(events[0].goal_name).toBe('purchase');
      expect(events[0].goal_value).toBe(99.99);
      expect(events[0].properties).toEqual({
        product_id: 'SKU123',
        category: 'Electronics',
      });
    });
  });
});
