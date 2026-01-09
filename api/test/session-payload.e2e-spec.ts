// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { EventBufferService } from '../src/events/event-buffer.service';
import {
  createTestWorkspace,
  createTestApiKey,
  truncateSystemTables,
  truncateWorkspaceTables,
  createTestApp,
  closeTestApp,
  getService,
  waitForClickHouse,
  waitForRowCount,
  TestAppContext,
} from './helpers';

const testWorkspaceId = 'test_ws_v3';

describe('V3 Session Payload E2E', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let eventBuffer: EventBufferService;
  let apiKey: string;

  const createSessionPayload = (overrides: Record<string, unknown> = {}) => ({
    workspace_id: testWorkspaceId,
    session_id: `sess-${Date.now()}`,
    actions: [],
    created_at: Date.now() - 10000,
    updated_at: Date.now(),
    ...overrides,
  });

  const createPageviewAction = (overrides: Record<string, unknown> = {}) => ({
    type: 'pageview',
    path: '/home',
    page_number: 1,
    duration: 5000,
    scroll: 50,
    entered_at: Date.now() - 5000,
    exited_at: Date.now(),
    ...overrides,
  });

  const createGoalAction = (overrides: Record<string, unknown> = {}) => ({
    type: 'goal',
    name: 'signup',
    path: '/register',
    page_number: 1,
    timestamp: Date.now(),
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp({ workspaceId: testWorkspaceId });
    systemClient = ctx.systemClient;
    workspaceClient = ctx.workspaceClient!;
    eventBuffer = getService(ctx, EventBufferService);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateSystemTables(systemClient, ['workspaces', 'api_keys']);
    await truncateWorkspaceTables(workspaceClient, [
      'events',
      'sessions',
      'pages',
    ]);
    await createTestWorkspace(systemClient, testWorkspaceId);
    apiKey = await createTestApiKey(systemClient, testWorkspaceId);
  });

  describe('POST /api/track', () => {
    it('accepts valid session payload', async () => {
      const payload = createSessionPayload({
        actions: [createPageviewAction()],
        attributes: {
          landing_page: 'https://example.com/home',
          browser: 'Chrome',
        },
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.checkpoint).toBe(1);
    });

    it('stores events in ClickHouse', async () => {
      const sessionId = `sess-store-${Date.now()}`;
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/home', page_number: 1 }),
          createGoalAction({ name: 'signup', page_number: 1 }),
          createPageviewAction({ path: '/dashboard', page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT name, path, page_number, goal_name
                FROM events
                WHERE session_id = {session_id:String}
                ORDER BY page_number, name`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const events = await result.json();

      expect(events).toHaveLength(3);
      // Events are ordered by page_number, then name (goal < screen_view alphabetically)
      expect(events[0]).toMatchObject({ name: 'goal', goal_name: 'signup' });
      expect(events[1]).toMatchObject({ name: 'screen_view', path: '/home' });
      expect(events[2]).toMatchObject({
        name: 'screen_view',
        path: '/dashboard',
      });
    });

    it('respects checkpoint - skips already processed actions', async () => {
      const sessionId = `sess-checkpoint-${Date.now()}`;

      // First request - send 2 actions
      const payload1 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/page1', page_number: 1 }),
          createPageviewAction({ path: '/page2', page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload1)
        .expect(200);

      expect(response1.body.checkpoint).toBe(2);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Second request - send 4 actions (cumulative), with checkpoint=2
      const payload2 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/page1', page_number: 1 }),
          createPageviewAction({ path: '/page2', page_number: 2 }),
          createPageviewAction({ path: '/page3', page_number: 3 }), // New
          createPageviewAction({ path: '/page4', page_number: 4 }), // New
        ],
        checkpoint: 2, // Skip first 2
        // No attributes - already sent
      });

      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload2)
        .expect(200);

      expect(response2.body.checkpoint).toBe(4);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Count events - should be 4 total (2 + 2 new)
      const result = await workspaceClient.query({
        query: `SELECT count() as cnt FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [{ cnt }] = await result.json();

      expect(Number(cnt)).toBe(4);
    });

    it('generates correct dedup_token for pageviews', async () => {
      const sessionId = 'sess-dedup-pv';
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createPageviewAction({ page_number: 5 })],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT dedup_token FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.dedup_token).toBe('sess-dedup-pv_pv_5');
    });

    it('generates correct dedup_token for goals', async () => {
      const sessionId = 'sess-dedup-goal';
      const timestamp = 1704067200000;
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createGoalAction({ name: 'purchase', timestamp })],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT dedup_token FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.dedup_token).toBe(
        'sess-dedup-goal_goal_purchase_1704067200000',
      );
    });

    it('sets _version server timestamp', async () => {
      const sessionId = `sess-version-${Date.now()}`;
      const beforeTime = Date.now();

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createPageviewAction()],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      const afterTime = Date.now();
      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT _version FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(Number(event._version)).toBeGreaterThanOrEqual(beforeTime);
      expect(Number(event._version)).toBeLessThanOrEqual(afterTime);
    });

    it('requires API key authentication', async () => {
      const payload = createSessionPayload({
        actions: [createPageviewAction()],
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(401);
    });

    it('rejects invalid workspace_id', async () => {
      const payload = createSessionPayload({
        workspace_id: 'invalid-ws',
        actions: [createPageviewAction()],
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(403);
    });

    it('validates nested actions', async () => {
      const payload = createSessionPayload({
        actions: [
          {
            type: 'pageview',
            // Missing required fields
          },
        ],
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('rejects unknown action type', async () => {
      const payload = createSessionPayload({
        actions: [
          {
            type: 'unknown_type',
            path: '/test',
          },
        ],
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(400);
    });
  });

  describe('Pages Materialized View', () => {
    it('creates page rows from pageview actions', async () => {
      const sessionId = `sess-pages-mv-${Date.now()}`;
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({
            path: '/home',
            page_number: 1,
            duration: 5000,
          }),
          createPageviewAction({
            path: '/about',
            page_number: 2,
            duration: 3000,
          }),
        ],
        attributes: { landing_page: 'https://example.com/home' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Wait for MV to process
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = '${sessionId}'`,
        2,
      );

      const result = await workspaceClient.query({
        query: `SELECT page_id, path, page_number, duration, is_landing
                FROM pages FINAL
                WHERE session_id = {session_id:String}
                ORDER BY page_number`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json();

      expect(pages).toHaveLength(2);
      expect(pages[0]).toMatchObject({
        page_id: `${sessionId}_1`,
        path: '/home',
        page_number: 1,
      });
      expect(Boolean(pages[0].is_landing)).toBe(true);
      expect(pages[1]).toMatchObject({
        page_id: `${sessionId}_2`,
        path: '/about',
        page_number: 2,
      });
      expect(Boolean(pages[1].is_landing)).toBe(false);
    });

    it('deduplicates pages with FINAL (ReplacingMergeTree)', async () => {
      const sessionId = `sess-pages-dedup-${Date.now()}`;

      // First payload
      const payload1 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({
            path: '/page',
            page_number: 1,
            duration: 5000,
            scroll: 30,
          }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload1)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Second payload - same page, updated values
      const payload2 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({
            path: '/page',
            page_number: 1,
            duration: 15000,
            scroll: 85,
          }),
        ],
        // No attributes (already sent), no checkpoint (testing dedup)
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload2)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Query with FINAL should return only 1 row with latest values
      const result = await workspaceClient.query({
        query: `SELECT page_id, duration, max_scroll
                FROM pages FINAL
                WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json();

      expect(pages).toHaveLength(1);
      expect(pages[0].duration).toBe(15000); // Latest value
      expect(pages[0].max_scroll).toBe(85); // Latest value
    });

    it('does not create page rows for goal events', async () => {
      const sessionId = `sess-no-goal-pages-${Date.now()}`;
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'signup', page_number: 1 }),
          createGoalAction({ name: 'purchase', page_number: 1 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = '${sessionId}'`,
        1, // Only 1 page (from pageview), not 3
      );

      const result = await workspaceClient.query({
        query: `SELECT count() as cnt FROM pages WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [{ cnt }] = await result.json();

      expect(Number(cnt)).toBe(1);
    });
  });

  describe('Sessions Materialized View', () => {
    it('aggregates goal_count and goal_value', async () => {
      const sessionId = `sess-goals-mv-${Date.now()}`;
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'add_to_cart', value: 50, page_number: 1 }),
          createGoalAction({ name: 'purchase', value: 150, page_number: 1 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = '${sessionId}'`,
        1,
      );

      const result = await workspaceClient.query({
        query: `SELECT goal_count, goal_value
                FROM sessions FINAL
                WHERE id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [session] = await result.json();

      expect(session.goal_count).toBe(2);
      expect(session.goal_value).toBeCloseTo(200, 0);
    });

    it('counts pageviews separately from goals', async () => {
      const sessionId = `sess-pv-goal-count-${Date.now()}`;
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
          createGoalAction({ name: 'signup', page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = '${sessionId}'`,
        1,
      );

      const result = await workspaceClient.query({
        query: `SELECT pageview_count, goal_count
                FROM sessions FINAL
                WHERE id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [session] = await result.json();

      expect(session.pageview_count).toBe(2);
      expect(session.goal_count).toBe(1);
    });
  });
});
