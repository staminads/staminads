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

// Workspace ID used in tests
const testWorkspaceId = 'page_tracking_test_ws';

/**
 * Helper to create a session payload in the V3 format
 */
function createSessionPayload(
  workspaceId: string,
  sessionId: string,
  options: {
    actions?: Array<{
      type: 'pageview' | 'goal';
      path: string;
      page_number: number;
      duration?: number;
      scroll?: number;
      entered_at?: number;
      exited_at?: number;
      name?: string;
      timestamp?: number;
      value?: number;
    }>;
    attributes?: {
      landing_page?: string;
      referrer?: string;
    };
    checkpoint?: number;
  } = {},
) {
  const now = Date.now();
  const actions = (options.actions || []).map((a) => {
    if (a.type === 'pageview') {
      return {
        type: 'pageview' as const,
        path: a.path,
        page_number: a.page_number,
        duration: a.duration ?? 0,
        scroll: a.scroll ?? 0,
        entered_at: a.entered_at ?? now,
        exited_at: a.exited_at ?? now + (a.duration ?? 0) * 1000,
      };
    } else {
      return {
        type: 'goal' as const,
        name: a.name || 'goal',
        path: a.path,
        page_number: a.page_number,
        timestamp: a.timestamp ?? now,
        value: a.value ?? 0,
      };
    }
  });

  return {
    workspace_id: workspaceId,
    session_id: sessionId,
    actions,
    attributes: options.attributes,
    checkpoint: options.checkpoint,
    created_at: now,
    updated_at: now,
    sdk_version: '6.0.0',
  };
}

describe('Page Duration Tracking E2E', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let eventBuffer: EventBufferService;
  let apiKey: string;

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
    // Clean tables before each test
    await truncateSystemTables(systemClient, ['workspaces', 'api_keys']);
    await truncateWorkspaceTables(workspaceClient, [
      'events',
      'sessions',
      'pages',
    ]);
    await createTestWorkspace(systemClient, testWorkspaceId);
    apiKey = await createTestApiKey(systemClient, testWorkspaceId);
  });

  describe('Event Storage', () => {
    it('stores page_duration field in events table from pageview action', async () => {
      const payload = createSessionPayload(testWorkspaceId, 'session-1', {
        actions: [
          // First pageview (landing page, will have duration on next pageview)
          {
            type: 'pageview',
            path: '/',
            page_number: 1,
            duration: 0,
            scroll: 0,
          },
          // Second pageview - this carries the duration of the previous page
          {
            type: 'pageview',
            path: '/about',
            page_number: 2,
            duration: 30, // 30 seconds on first page
            scroll: 50,
          },
        ],
        attributes: { landing_page: 'https://test.com/' },
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      expect(response.body.success).toBe(true);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT page_duration, path FROM events
                WHERE session_id = {session_id:String} ORDER BY page_number`,
        query_params: { session_id: 'session-1' },
        format: 'JSONEachRow',
      });
      const events =
        await result.json<{ page_duration: number; path: string }[]>();

      expect(events).toHaveLength(2);
      expect(events[0].path).toBe('/');
      expect(events[0].page_duration).toBe(0); // Landing page, no duration yet
      expect(events[1].path).toBe('/about');
      expect(events[1].page_duration).toBe(30); // Duration from action
    });

    it('stores previous_path field from pageview chain', async () => {
      const payload = createSessionPayload(testWorkspaceId, 'session-2', {
        actions: [
          { type: 'pageview', path: '/home', page_number: 1, duration: 0 },
          { type: 'pageview', path: '/products', page_number: 2, duration: 15 },
          { type: 'pageview', path: '/checkout', page_number: 3, duration: 20 },
        ],
        attributes: { landing_page: 'https://test.com/home' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT path, previous_path FROM events
                WHERE session_id = {session_id:String} ORDER BY page_number`,
        query_params: { session_id: 'session-2' },
        format: 'JSONEachRow',
      });
      const events =
        await result.json<{ path: string; previous_path: string }[]>();

      expect(events).toHaveLength(3);
      expect(events[0].path).toBe('/home');
      expect(events[0].previous_path).toBe(''); // First page has no previous
      expect(events[1].path).toBe('/products');
      expect(events[1].previous_path).toBe('/home');
      expect(events[2].path).toBe('/checkout');
      expect(events[2].previous_path).toBe('/products');
    });

    it('handles missing duration (defaults to 0)', async () => {
      const payload = createSessionPayload(testWorkspaceId, 'session-3', {
        actions: [{ type: 'pageview', path: '/test', page_number: 1 }],
        attributes: { landing_page: 'https://test.com/test' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT page_duration FROM events
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: 'session-3' },
        format: 'JSONEachRow',
      });
      const events = await result.json<{ page_duration: number }[]>();

      expect(events).toHaveLength(1);
      expect(events[0].page_duration).toBe(0);
    });
  });

  describe('Sessions Materialized View', () => {
    it('calculates pageview_count from screen_view events', async () => {
      const sessionId = 'session-pageview-count';

      // Send 3 pageview actions
      const payload = createSessionPayload(testWorkspaceId, sessionId, {
        actions: [
          { type: 'pageview', path: '/page1', page_number: 1, duration: 0 },
          { type: 'pageview', path: '/page2', page_number: 2, duration: 10 },
          { type: 'pageview', path: '/page3', page_number: 3, duration: 15 },
        ],
        attributes: { landing_page: 'https://test.com/page1' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = {session_id:String}`,
        1,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      const result = await workspaceClient.query({
        query: `SELECT pageview_count FROM sessions FINAL
                WHERE id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const sessions = await result.json<{ pageview_count: number }[]>();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].pageview_count).toBe(3);
    });

    it('calculates median_page_duration from events with page_duration > 0', async () => {
      const sessionId = 'session-median-duration';

      const payload = createSessionPayload(testWorkspaceId, sessionId, {
        actions: [
          { type: 'pageview', path: '/page1', page_number: 1, duration: 0 },
          { type: 'pageview', path: '/page2', page_number: 2, duration: 20 },
          { type: 'pageview', path: '/page3', page_number: 3, duration: 40 },
        ],
        attributes: { landing_page: 'https://test.com/page1' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = {session_id:String}`,
        1,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      const result = await workspaceClient.query({
        query: `SELECT median_page_duration FROM sessions FINAL
                WHERE id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const sessions = await result.json<{ median_page_duration: number }[]>();

      expect(sessions).toHaveLength(1);
      // Median of [20, 40] = 30
      expect(sessions[0].median_page_duration).toBe(30);
    });

    it('handles sessions with single pageview (median = 0 when no duration)', async () => {
      const sessionId = 'session-single-page';

      const payload = createSessionPayload(testWorkspaceId, sessionId, {
        actions: [
          { type: 'pageview', path: '/landing', page_number: 1, duration: 0 },
        ],
        attributes: { landing_page: 'https://test.com/landing' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = {session_id:String}`,
        1,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      const result = await workspaceClient.query({
        query: `SELECT pageview_count, median_page_duration FROM sessions FINAL
                WHERE id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const sessions =
        await result.json<
          { pageview_count: number; median_page_duration: number }[]
        >();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].pageview_count).toBe(1);
      expect(sessions[0].median_page_duration).toBe(0);
    });
  });

  describe('Pages Materialized View', () => {
    it('creates page rows from all pageview actions', async () => {
      const sessionId = 'session-pages-mv';

      const payload = createSessionPayload(testWorkspaceId, sessionId, {
        actions: [
          { type: 'pageview', path: '/home', page_number: 1, duration: 10 },
          {
            type: 'pageview',
            path: '/about',
            page_number: 2,
            duration: 25,
            scroll: 75,
          },
        ],
        attributes: { landing_page: 'https://test.com/home' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = {session_id:String}`,
        2,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      const result = await workspaceClient.query({
        query: `SELECT path, page_number, duration FROM pages
                WHERE session_id = {session_id:String}
                ORDER BY page_number`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json<
        { path: string; page_number: number; duration: number }[]
      >();

      // Each pageview creates a page row with matching path and duration
      expect(pages).toHaveLength(2);
      expect(pages[0].path).toBe('/home');
      expect(pages[0].page_number).toBe(1);
      expect(pages[0].duration).toBe(10);
      expect(pages[1].path).toBe('/about');
      expect(pages[1].page_number).toBe(2);
      expect(pages[1].duration).toBe(25);
    });

    it('creates page row for landing pageview', async () => {
      const sessionId = 'session-landing-page';

      const payload = createSessionPayload(testWorkspaceId, sessionId, {
        actions: [
          { type: 'pageview', path: '/landing', page_number: 1, duration: 5 },
        ],
        attributes: { landing_page: 'https://test.com/landing' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = {session_id:String}`,
        1,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      const result = await workspaceClient.query({
        query: `SELECT path, page_number, duration FROM pages
                WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json<
        { path: string; page_number: number; duration: number }[]
      >();

      expect(pages).toHaveLength(1);
      expect(pages[0].path).toBe('/landing');
      expect(pages[0].page_number).toBe(1);
      expect(pages[0].duration).toBe(5);
    });
  });

  describe('Full Flow Simulation', () => {
    it('simulates multi-page session and verifies all data', async () => {
      const sessionId = 'session-full-flow';

      // Simulate a multi-page session with duration on each page
      const payload = createSessionPayload(testWorkspaceId, sessionId, {
        actions: [
          // Event 1: Pageview on /home (10s duration)
          { type: 'pageview', path: '/home', page_number: 1, duration: 10 },
          // Event 2: Pageview on /about (30s duration)
          {
            type: 'pageview',
            path: '/about',
            page_number: 2,
            duration: 30,
            scroll: 50,
          },
          // Event 3: Pageview on /contact (20s duration)
          {
            type: 'pageview',
            path: '/contact',
            page_number: 3,
            duration: 20,
            scroll: 100,
          },
        ],
        attributes: { landing_page: 'https://test.com/home' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();

      // Wait for data to propagate
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id = {session_id:String}`,
        3,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = {session_id:String}`,
        1,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = {session_id:String}`,
        3,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      // Verify events table
      const eventsResult = await workspaceClient.query({
        query: `SELECT name, path, page_duration, previous_path
                FROM events
                WHERE session_id = {session_id:String}
                ORDER BY page_number`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const events = await eventsResult.json<
        {
          name: string;
          path: string;
          page_duration: number;
          previous_path: string;
        }[]
      >();

      expect(events).toHaveLength(3);

      // Event 1: Landing page
      expect(events[0].name).toBe('screen_view');
      expect(events[0].path).toBe('/home');
      expect(events[0].page_duration).toBe(10);
      expect(events[0].previous_path).toBe('');

      // Event 2: Second page (has previous_path)
      expect(events[1].name).toBe('screen_view');
      expect(events[1].path).toBe('/about');
      expect(events[1].page_duration).toBe(30);
      expect(events[1].previous_path).toBe('/home');

      // Event 3: Third page
      expect(events[2].name).toBe('screen_view');
      expect(events[2].path).toBe('/contact');
      expect(events[2].page_duration).toBe(20);
      expect(events[2].previous_path).toBe('/about');

      // Verify sessions table
      const sessionsResult = await workspaceClient.query({
        query: `SELECT pageview_count, median_page_duration
                FROM sessions FINAL
                WHERE id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const sessions = await sessionsResult.json<
        {
          pageview_count: number;
          median_page_duration: number;
        }[]
      >();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].pageview_count).toBe(3);
      expect(sessions[0].median_page_duration).toBe(20); // median([10, 30, 20]) = 20

      // Verify pages table - each pageview creates a page entry
      const pagesResult = await workspaceClient.query({
        query: `SELECT path, page_number, duration
                FROM pages
                WHERE session_id = {session_id:String}
                ORDER BY page_number`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await pagesResult.json<
        {
          path: string;
          page_number: number;
          duration: number;
        }[]
      >();

      expect(pages).toHaveLength(3);

      // Page 1: /home with its own duration
      expect(pages[0].path).toBe('/home');
      expect(pages[0].page_number).toBe(1);
      expect(pages[0].duration).toBe(10);

      // Page 2: /about with its own duration
      expect(pages[1].path).toBe('/about');
      expect(pages[1].page_number).toBe(2);
      expect(pages[1].duration).toBe(30);

      // Page 3: /contact with its own duration
      expect(pages[2].path).toBe('/contact');
      expect(pages[2].page_number).toBe(3);
      expect(pages[2].duration).toBe(20);
    });
  });
});
