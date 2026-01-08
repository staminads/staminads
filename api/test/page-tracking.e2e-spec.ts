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
    it('stores page_duration field in events table', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-page-duration-1',
          name: 'screen_view',
          path: '/about',
          landing_page: 'https://test.com/',
          page_duration: 30,
          previous_path: '/',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT page_duration, previous_path FROM events
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: 'session-page-duration-1' },
        format: 'JSONEachRow',
      });
      const events =
        await result.json<{ page_duration: number; previous_path: string }[]>();

      expect(events).toHaveLength(1);
      expect(events[0].page_duration).toBe(30);
    });

    it('stores previous_path field in events table', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-previous-path-1',
          name: 'screen_view',
          path: '/products',
          landing_page: 'https://test.com/home',
          page_duration: 15,
          previous_path: '/home',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT previous_path FROM events
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: 'session-previous-path-1' },
        format: 'JSONEachRow',
      });
      const events = await result.json<{ previous_path: string }[]>();

      expect(events).toHaveLength(1);
      expect(events[0].previous_path).toBe('/home');
    });

    it('handles missing page_duration (defaults to 0)', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-no-duration',
          name: 'screen_view',
          path: '/test',
          landing_page: 'https://test.com/test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT page_duration FROM events
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: 'session-no-duration' },
        format: 'JSONEachRow',
      });
      const events = await result.json<{ page_duration: number }[]>();

      expect(events).toHaveLength(1);
      expect(events[0].page_duration).toBe(0);
    });

    it('handles missing previous_path (defaults to empty string)', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-no-previous',
          name: 'screen_view',
          path: '/landing',
          landing_page: 'https://test.com/landing',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT previous_path FROM events
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: 'session-no-previous' },
        format: 'JSONEachRow',
      });
      const events = await result.json<{ previous_path: string }[]>();

      expect(events).toHaveLength(1);
      expect(events[0].previous_path).toBe('');
    });
  });

  describe('Sessions Materialized View', () => {
    it('calculates pageview_count from screen_view events', async () => {
      const sessionId = 'session-pageview-count';
      const now = Date.now();

      // Send 3 screen_view events
      for (let i = 0; i < 3; i++) {
        await request(ctx.app.getHttpServer())
          .post('/api/track')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            workspace_id: testWorkspaceId,
            session_id: sessionId,
            name: 'screen_view',
            path: `/page${i + 1}`,
            landing_page: 'https://test.com/page1',
            page_duration: i > 0 ? 10 + i * 5 : 0, // 0 for landing, then 15, 20
            previous_path: i > 0 ? `/page${i}` : '',
            created_at: now,
            updated_at: now + i * 1000,
          })
          .expect(200);
      }

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

    it('calculates median_page_duration (median) from events with page_duration > 0', async () => {
      const sessionId = 'session-avg-duration';
      const now = Date.now();

      // Navigation event 1: duration 20s (for previous page)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/page2',
          landing_page: 'https://test.com/page1',
          page_duration: 20,
          previous_path: '/page1',
          created_at: now,
          updated_at: now + 20000,
        })
        .expect(200);

      // Navigation event 2: duration 40s (for previous page)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/page3',
          landing_page: 'https://test.com/page1',
          page_duration: 40,
          previous_path: '/page2',
          created_at: now,
          updated_at: now + 60000,
        })
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
      const now = Date.now();

      // Single screen_view (landing page, no duration)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/landing',
          landing_page: 'https://test.com/landing',
          created_at: now,
          updated_at: now,
        })
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
    it('creates page row from navigation screen_view using previous_path', async () => {
      const sessionId = 'session-pages-mv-nav';
      const now = Date.now();

      // Navigation event: from /home to /about after 25s
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/about',
          landing_page: 'https://test.com/home',
          landing_path: '/home',
          page_duration: 25,
          previous_path: '/home',
          created_at: now,
          updated_at: now + 25000,
        })
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
        query: `SELECT path, duration, is_landing, is_exit FROM pages
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json<
        {
          path: string;
          duration: number;
          is_landing: boolean;
          is_exit: boolean;
        }[]
      >();

      expect(pages).toHaveLength(1);
      // Page should use previous_path (the page being left, which had the duration)
      expect(pages[0].path).toBe('/home');
      expect(pages[0].duration).toBe(25);
    });

    it('creates page row from unload ping using path', async () => {
      const sessionId = 'session-pages-mv-ping';
      const now = Date.now();

      // Unload ping: leaving /final after 18s
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'ping',
          path: '/final',
          landing_page: 'https://test.com/start',
          landing_path: '/start',
          page_duration: 18,
          created_at: now,
          updated_at: now + 18000,
        })
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
        query: `SELECT path, duration, is_exit FROM pages
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json<
        {
          path: string;
          duration: number;
          is_exit: boolean;
        }[]
      >();

      expect(pages).toHaveLength(1);
      // Ping uses current path (no previous_path)
      expect(pages[0].path).toBe('/final');
      expect(pages[0].duration).toBe(18);
      // Ping events are exit pages
      expect(pages[0].is_exit).toBe(true);
    });

    it('is_landing is true when path equals landing_path', async () => {
      const sessionId = 'session-landing-flag';
      const now = Date.now();

      // Navigation event where previous_path matches landing_path
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/page2',
          landing_page: 'https://test.com/landing',
          landing_path: '/landing',
          page_duration: 12,
          previous_path: '/landing', // Leaving the landing page
          created_at: now,
          updated_at: now + 12000,
        })
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
        query: `SELECT path, is_landing FROM pages
                WHERE session_id = {session_id:String} LIMIT 1`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages =
        await result.json<{ path: string; is_landing: boolean }[]>();

      expect(pages).toHaveLength(1);
      expect(pages[0].path).toBe('/landing');
      expect(pages[0].is_landing).toBe(true);
    });

    it('does not create row for landing screen_view (no previous_path)', async () => {
      const sessionId = 'session-no-page-landing';
      const now = Date.now();

      // Initial landing screen_view (no page_duration or previous_path)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/landing',
          landing_page: 'https://test.com/landing',
          created_at: now,
          updated_at: now,
        })
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT count() as cnt FROM pages
                WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const counts = await result.json<{ cnt: string }[]>();

      // No page should be created for initial landing (no duration data yet)
      expect(parseInt(counts[0].cnt, 10)).toBe(0);
    });
  });

  describe('Full Flow Simulation', () => {
    it('simulates multi-page session and verifies all data', async () => {
      const sessionId = 'session-full-flow';
      const now = Date.now();

      // Event 1: Landing screen_view (no duration)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/home',
          landing_page: 'https://test.com/home',
          landing_path: '/home',
          created_at: now,
          updated_at: now,
        })
        .expect(200);

      // Event 2: Navigation to /about (30s on /home)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/about',
          landing_page: 'https://test.com/home',
          landing_path: '/home',
          page_duration: 30,
          previous_path: '/home',
          created_at: now,
          updated_at: now + 30000,
        })
        .expect(200);

      // Event 3: Unload ping (20s on /about)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'ping',
          path: '/about',
          landing_page: 'https://test.com/home',
          landing_path: '/home',
          page_duration: 20,
          created_at: now,
          updated_at: now + 50000,
        })
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
        2,
        { session_id: sessionId },
        { timeoutMs: 5000 },
      );

      // Verify events table
      const eventsResult = await workspaceClient.query({
        query: `SELECT name, path, page_duration, previous_path
                FROM events
                WHERE session_id = {session_id:String}
                ORDER BY updated_at`,
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

      // Event 1: Landing (no duration)
      expect(events[0].name).toBe('screen_view');
      expect(events[0].path).toBe('/home');
      expect(events[0].page_duration).toBe(0);
      expect(events[0].previous_path).toBe('');

      // Event 2: Navigation (has duration and previous_path)
      expect(events[1].name).toBe('screen_view');
      expect(events[1].path).toBe('/about');
      expect(events[1].page_duration).toBe(30);
      expect(events[1].previous_path).toBe('/home');

      // Event 3: Unload ping (has duration, no previous_path)
      expect(events[2].name).toBe('ping');
      expect(events[2].path).toBe('/about');
      expect(events[2].page_duration).toBe(20);

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
      expect(sessions[0].pageview_count).toBe(2); // 2 screen_views
      expect(sessions[0].median_page_duration).toBe(25); // median([30, 20]) = 25

      // Verify pages table
      const pagesResult = await workspaceClient.query({
        query: `SELECT path, duration, is_landing, is_exit
                FROM pages
                WHERE session_id = {session_id:String}
                ORDER BY entered_at`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await pagesResult.json<
        {
          path: string;
          duration: number;
          is_landing: boolean;
          is_exit: boolean;
        }[]
      >();

      expect(pages).toHaveLength(2);

      // Page 1: /home (from navigation event)
      expect(pages[0].path).toBe('/home');
      expect(pages[0].duration).toBe(30);
      expect(pages[0].is_landing).toBe(true);
      expect(pages[0].is_exit).toBe(false);

      // Page 2: /about (from unload ping)
      expect(pages[1].path).toBe('/about');
      expect(pages[1].duration).toBe(20);
      expect(pages[1].is_landing).toBe(false);
      expect(pages[1].is_exit).toBe(true);
    });
  });
});
