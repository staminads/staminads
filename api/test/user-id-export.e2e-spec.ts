// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { EventBufferService } from '../src/events/event-buffer.service';
import {
  createTestWorkspace,
  createTestApiKey,
  createTestUser,
  createMembership,
  getAuthToken,
  truncateSystemTables,
  truncateWorkspaceTables,
  createTestApp,
  closeTestApp,
  getService,
  waitForClickHouse,
  waitForRowCount,
  TestAppContext,
} from './helpers';

const testWorkspaceId = 'test_ws_user_id';

// Helper for until parameter - 1 minute in future for tests
const getUntil = () => new Date(Date.now() + 60000).toISOString();

describe('User ID Tracking & Export E2E', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let eventBuffer: EventBufferService;
  let apiKey: string;
  let userToken: string;

  const createSessionPayload = (overrides: Record<string, unknown> = {}) => ({
    workspace_id: testWorkspaceId,
    session_id: `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    await truncateSystemTables(systemClient, [
      'workspaces',
      'api_keys',
      'users',
      'workspace_memberships',
    ]);
    await truncateWorkspaceTables(workspaceClient, [
      'events',
      'sessions',
      'pages',
      'goals',
    ]);

    await createTestWorkspace(systemClient, testWorkspaceId);
    apiKey = await createTestApiKey(systemClient, testWorkspaceId);

    // Create user with workspace access for export endpoint
    const userId = await createTestUser(systemClient, 'test@example.com');
    await createMembership(systemClient, testWorkspaceId, userId, 'admin');
    userToken = await getAuthToken(ctx.app, 'test@example.com', 'testpass123');
  });

  describe('User ID set mid-session (simulating user sign-in)', () => {
    it('propagates user_id to all events when set after initial pageviews', async () => {
      const sessionId = `sess-mid-signin-${Date.now()}`;
      const userId = 'user_authenticated_123';

      // First payload: Anonymous browsing (no user_id)
      const payload1 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/home', page_number: 1 }),
          createPageviewAction({ path: '/products', page_number: 2 }),
        ],
        attributes: {
          landing_page: 'https://example.com/home',
          browser: 'Chrome',
        },
        // No user_id - anonymous session
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload1)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Verify events created without user_id
      const anonResult = await workspaceClient.query({
        query: `SELECT user_id FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const anonEvents = await anonResult.json();
      expect(anonEvents).toHaveLength(2);
      expect(
        anonEvents.every((e: { user_id: string | null }) => e.user_id === null),
      ).toBe(true);

      // Second payload: User signs in (user_id now set)
      const payload2 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/account', page_number: 3 }),
          createGoalAction({ name: 'login', page_number: 3 }),
        ],
        user_id: userId, // User now authenticated
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload2)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Verify new events have user_id
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id = '${sessionId}'`,
        4,
      );

      const result = await workspaceClient.query({
        query: `SELECT name, path, user_id FROM events
                WHERE session_id = {session_id:String}
                ORDER BY page_number`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const events = await result.json();

      expect(events).toHaveLength(4);
      // First 2 events: no user_id (anonymous)
      expect(events[0].user_id).toBeNull();
      expect(events[1].user_id).toBeNull();
      // Last 2 events: have user_id (authenticated)
      expect(events[2].user_id).toBe(userId);
      expect(events[3].user_id).toBe(userId);
    });

    it('propagates user_id to sessions table via MV', async () => {
      const sessionId = `sess-mv-session-${Date.now()}`;
      const userId = 'user_session_mv_test';

      // Send payload with user_id
      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ page_number: 1 }),
          createPageviewAction({ page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
        user_id: userId,
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Wait for session MV to process
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = '${sessionId}'`,
        1,
      );

      const result = await workspaceClient.query({
        query: `SELECT id, user_id, pageview_count FROM sessions FINAL WHERE id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [session] = await result.json();

      expect(session.id).toBe(sessionId);
      expect(session.user_id).toBe(userId);
      expect(session.pageview_count).toBe(2);
    });

    it('propagates user_id to pages table via MV', async () => {
      const sessionId = `sess-mv-pages-${Date.now()}`;
      const userId = 'user_pages_mv_test';

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/landing', page_number: 1 }),
          createPageviewAction({ path: '/checkout', page_number: 2 }),
        ],
        attributes: { landing_page: 'https://example.com/landing' },
        user_id: userId,
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Wait for pages MV to process
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = '${sessionId}'`,
        2,
      );

      const result = await workspaceClient.query({
        query: `SELECT path, page_number, user_id FROM pages FINAL
                WHERE session_id = {session_id:String}
                ORDER BY page_number`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const pages = await result.json();

      expect(pages).toHaveLength(2);
      expect(pages[0]).toMatchObject({
        path: '/landing',
        page_number: 1,
        user_id: userId,
      });
      expect(pages[1]).toMatchObject({
        path: '/checkout',
        page_number: 2,
        user_id: userId,
      });
    });

    it('propagates user_id to goals table via MV', async () => {
      const sessionId = `sess-mv-goals-${Date.now()}`;
      const userId = 'user_goals_mv_test';

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ page_number: 1 }),
          createGoalAction({ name: 'add_to_cart', value: 50, page_number: 1 }),
          createGoalAction({ name: 'purchase', value: 150, page_number: 1 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
        user_id: userId,
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Wait for goals MV to process
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM goals WHERE session_id = '${sessionId}'`,
        2,
      );

      const result = await workspaceClient.query({
        query: `SELECT goal_name, goal_value, user_id FROM goals FINAL
                WHERE session_id = {session_id:String}
                ORDER BY goal_name`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const goals = await result.json();

      expect(goals).toHaveLength(2);
      expect(goals[0]).toMatchObject({
        goal_name: 'add_to_cart',
        goal_value: 50,
        user_id: userId,
      });
      expect(goals[1]).toMatchObject({
        goal_name: 'purchase',
        goal_value: 150,
        user_id: userId,
      });
    });

    it('handles user_id set to null explicitly', async () => {
      const sessionId = `sess-null-user-${Date.now()}`;

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: { landing_page: 'https://example.com/' },
        user_id: null, // Explicitly null
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT user_id FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.user_id).toBeNull();
    });
  });

  describe('Custom dimensions (stm_1-10) propagation', () => {
    it('propagates all 10 dimensions from SDK payload to events', async () => {
      const sessionId = `sess-dims-${Date.now()}`;
      const dimensions: Record<string, string> = {};
      for (let i = 1; i <= 10; i++) {
        dimensions[`stm_${i}`] = `dim_value_${i}`;
      }

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: { landing_page: 'https://example.com/' },
        dimensions,
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT stm_1, stm_2, stm_3, stm_4, stm_5, stm_6, stm_7, stm_8, stm_9, stm_10
                FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      for (let i = 1; i <= 10; i++) {
        expect(event[`stm_${i}`]).toBe(`dim_value_${i}`);
      }
    });

    it('handles sparse dimensions (only some set)', async () => {
      const sessionId = `sess-sparse-dims-${Date.now()}`;

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: { landing_page: 'https://example.com/' },
        dimensions: {
          stm_1: 'campaign_a',
          stm_5: 'variant_b',
          stm_10: 'user_segment',
        },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT stm_1, stm_2, stm_3, stm_4, stm_5, stm_6, stm_7, stm_8, stm_9, stm_10
                FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.stm_1).toBe('campaign_a');
      expect(event.stm_2).toBe(''); // Not set
      expect(event.stm_5).toBe('variant_b');
      expect(event.stm_10).toBe('user_segment');
    });

    it('propagates dimensions to sessions MV', async () => {
      const sessionId = `sess-dims-mv-${Date.now()}`;

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [createPageviewAction({ page_number: 1 })],
        attributes: { landing_page: 'https://example.com/' },
        dimensions: {
          stm_1: 'test_campaign',
          stm_2: 'test_variant',
        },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
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
        query: `SELECT stm_1, stm_2 FROM sessions FINAL WHERE id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [session] = await result.json();

      expect(session.stm_1).toBe('test_campaign');
      expect(session.stm_2).toBe('test_variant');
    });
  });

  describe('GET /api/export.userEvents', () => {
    it('returns events with user_id set', async () => {
      const sessionId = `sess-export-${Date.now()}`;
      const userId = 'user_export_test';

      const payload = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/home', page_number: 1 }),
          createGoalAction({ name: 'signup', page_number: 1 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
        user_id: userId,
        dimensions: { stm_1: 'test_campaign' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id = '${sessionId}'`,
        2,
      );

      // Call export endpoint
      const since = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until: getUntil() })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
      expect(response.body).toHaveProperty('has_more');
      expect(response.body).toHaveProperty('next_cursor');

      // Verify event data includes all fields
      const userEvents = response.body.data.filter(
        (e: { session_id: string }) => e.session_id === sessionId,
      );
      expect(userEvents.length).toBe(2);

      const screenView = userEvents.find(
        (e: { name: string }) => e.name === 'screen_view',
      );
      const goal = userEvents.find((e: { name: string }) => e.name === 'goal');

      expect(screenView).toMatchObject({
        session_id: sessionId,
        user_id: userId,
        name: 'screen_view',
        path: '/home',
        stm_1: 'test_campaign',
      });

      expect(goal).toMatchObject({
        session_id: sessionId,
        user_id: userId,
        name: 'goal',
        goal_name: 'signup',
      });
    });

    it('excludes events without user_id', async () => {
      const sessionWithUser = `sess-with-user-${Date.now()}`;
      const sessionWithoutUser = `sess-without-user-${Date.now()}`;

      // Session with user_id
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionWithUser,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            user_id: 'user_included',
          }),
        )
        .expect(200);

      // Session without user_id
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionWithoutUser,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            // No user_id
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id IN ('${sessionWithUser}', '${sessionWithoutUser}')`,
        2,
      );

      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until: getUntil() })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Should only include the event with user_id
      const sessionIds = response.body.data.map(
        (e: { session_id: string }) => e.session_id,
      );
      expect(sessionIds).toContain(sessionWithUser);
      expect(sessionIds).not.toContain(sessionWithoutUser);
    });

    it('filters by specific user_id', async () => {
      const session1 = `sess-user1-${Date.now()}`;
      const session2 = `sess-user2-${Date.now()}`;

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: session1,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            user_id: 'user_one',
          }),
        )
        .expect(200);

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: session2,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            user_id: 'user_two',
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id IN ('${session1}', '${session2}')`,
        2,
      );

      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          since,
          until: getUntil(),
          user_id: 'user_one',
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Should only include user_one's events
      expect(
        response.body.data.every(
          (e: { user_id: string }) => e.user_id === 'user_one',
        ),
      ).toBe(true);
    });

    it('supports cursor-based pagination', async () => {
      // Create multiple events
      for (let i = 0; i < 5; i++) {
        await request(ctx.app.getHttpServer())
          .post('/api/track')
          .send(
            createSessionPayload({
              session_id: `sess-page-${i}-${Date.now()}`,
              actions: [createPageviewAction({ page_number: 1 })],
              attributes: { landing_page: 'https://example.com/' },
              user_id: 'user_pagination',
            }),
          )
          .expect(200);
      }

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // First page with limit 2
      const since = new Date(Date.now() - 60000).toISOString();
      const until = getUntil();
      const page1 = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until, limit: 2 })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(page1.body.data.length).toBe(2);
      expect(page1.body.has_more).toBe(true);
      expect(page1.body.next_cursor).not.toBeNull();

      // Second page using cursor
      const page2 = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          cursor: page1.body.next_cursor,
          until,
          limit: 2,
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(page2.body.data.length).toBe(2);

      // Verify no duplicates between pages
      const page1Ids = page1.body.data.map((e: { id: string }) => e.id);
      const page2Ids = page2.body.data.map((e: { id: string }) => e.id);
      const intersection = page1Ids.filter((id: string) =>
        page2Ids.includes(id),
      );
      expect(intersection).toHaveLength(0);
    });

    it('requires since or cursor parameter', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, until: getUntil() })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toContain('cursor or since');
    });

    it('requires until parameter', async () => {
      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      // message is an array from class-validator
      expect(response.body.message.join(' ')).toContain('until');
    });

    it('requires authentication', async () => {
      const since = new Date(Date.now() - 60000).toISOString();
      await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until: getUntil() })
        .expect(401);
    });
  });

  describe('Edge cases', () => {
    it('handles user_id change mid-session (user logout/login as different user)', async () => {
      const sessionId = `sess-user-change-${Date.now()}`;

      // User A is logged in
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [
              createPageviewAction({ path: '/dashboard', page_number: 1 }),
            ],
            attributes: { landing_page: 'https://example.com/' },
            user_id: 'user_a',
          }),
        )
        .expect(200);

      // User A logs out, User B logs in (same session/device)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [
              createPageviewAction({ path: '/profile', page_number: 2 }),
            ],
            user_id: 'user_b', // Different user
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id = '${sessionId}'`,
        2,
      );

      // Both events should be in export with their respective user_ids
      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until: getUntil() })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const sessionEvents = response.body.data.filter(
        (e: { session_id: string }) => e.session_id === sessionId,
      );
      expect(sessionEvents.length).toBe(2);

      const userAEvent = sessionEvents.find(
        (e: { user_id: string }) => e.user_id === 'user_a',
      );
      const userBEvent = sessionEvents.find(
        (e: { user_id: string }) => e.user_id === 'user_b',
      );

      expect(userAEvent.path).toBe('/dashboard');
      expect(userBEvent.path).toBe('/profile');
    });

    it('handles max length user_id (256 characters)', async () => {
      const sessionId = `sess-long-uid-${Date.now()}`;
      const longUserId = 'u'.repeat(256);

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            user_id: longUserId,
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT user_id FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.user_id).toBe(longUserId);
      expect(event.user_id.length).toBe(256);
    });

    it('handles special characters in user_id', async () => {
      const sessionId = `sess-special-uid-${Date.now()}`;
      const specialUserId = "user@example.com|org:abc-123|role:'admin'";

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            user_id: specialUserId,
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT user_id FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.user_id).toBe(specialUserId);
    });

    it('handles empty string dimension values', async () => {
      const sessionId = `sess-empty-dim-${Date.now()}`;

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            dimensions: {
              stm_1: '', // Explicitly empty
              stm_2: 'has_value',
            },
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      const result = await workspaceClient.query({
        query: `SELECT stm_1, stm_2 FROM events WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [event] = await result.json();

      expect(event.stm_1).toBe('');
      expect(event.stm_2).toBe('has_value');
    });

    it('handles event updates via ReplacingMergeTree (same dedup_token)', async () => {
      const sessionId = `sess-update-${Date.now()}`;
      const userId = 'user_updating';

      // First payload with initial duration
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
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
            user_id: userId,
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Second payload updating the same page (same dedup_token)
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [
              createPageviewAction({
                path: '/page',
                page_number: 1,
                duration: 15000, // Updated duration
                scroll: 85, // Updated scroll
              }),
            ],
            user_id: userId,
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse(200);

      // Query with FINAL should return latest version
      const result = await workspaceClient.query({
        query: `SELECT user_id, duration, max_scroll
                FROM events FINAL
                WHERE session_id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const events = await result.json();

      // Should have 1 deduplicated event with latest values
      expect(events).toHaveLength(1);
      expect(events[0].user_id).toBe(userId);
      expect(Number(events[0].duration)).toBe(15000);
      expect(Number(events[0].max_scroll)).toBe(85);

      // Export should also return the deduplicated event
      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until: getUntil() })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const exportedEvents = response.body.data.filter(
        (e: { session_id: string }) => e.session_id === sessionId,
      );
      expect(exportedEvents.length).toBe(1);
      expect(exportedEvents[0].user_id).toBe(userId);
    });
  });

  describe('API Key authentication for export', () => {
    it('allows export with API key authentication', async () => {
      const sessionId = `sess-apikey-${Date.now()}`;

      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [createPageviewAction({ page_number: 1 })],
            attributes: { landing_page: 'https://example.com/' },
            user_id: 'user_apikey_test',
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id = '${sessionId}'`,
        1,
      );

      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({ workspace_id: testWorkspaceId, since, until: getUntil() })
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      const exported = response.body.data.find(
        (e: { session_id: string }) => e.session_id === sessionId,
      );
      expect(exported.user_id).toBe('user_apikey_test');
    });
  });

  describe('Export error handling', () => {
    it('returns 400 for invalid cursor format', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          cursor: 'not-valid-base64!',
          until: getUntil(),
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toContain('cursor');
    });

    it('returns 400 for malformed cursor JSON', async () => {
      // Valid base64 but invalid JSON
      const badCursor = Buffer.from('not-json').toString('base64');

      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          cursor: badCursor,
          until: getUntil(),
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toContain('cursor');
    });

    it('returns 400 for cursor missing required fields', async () => {
      // Valid JSON but missing id field
      const incompleteCursor = Buffer.from(
        JSON.stringify({ updated_at: '2025-01-25 10:00:00.000' }),
      ).toString('base64');

      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          cursor: incompleteCursor,
          until: getUntil(),
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(response.body.message).toContain('cursor');
    });

    it('returns empty result for future since timestamp', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
      const futureUntil = new Date(Date.now() + 86400000 + 60000).toISOString(); // Tomorrow + 1 min

      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          since: futureDate,
          until: futureUntil,
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.has_more).toBe(false);
      expect(response.body.next_cursor).toBeNull();
    });
  });

  describe('Full roundtrip: SDK → API → export', () => {
    it('complete flow with user_id and dimensions', async () => {
      const sessionId = `sess-roundtrip-${Date.now()}`;
      const userId = 'user_roundtrip_test';
      const dimensions = {
        stm_1: 'campaign_spring',
        stm_2: 'variant_a',
        stm_3: 'segment_premium',
      };

      // 1. Anonymous pageview
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [
              createPageviewAction({ path: '/landing', page_number: 1 }),
            ],
            attributes: {
              landing_page: 'https://example.com/landing',
              utm_source: 'google',
              utm_medium: 'cpc',
            },
          }),
        )
        .expect(200);

      // 2. User signs in with more pageviews
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [
              createPageviewAction({ path: '/login', page_number: 2 }),
              createPageviewAction({ path: '/dashboard', page_number: 3 }),
            ],
            user_id: userId,
            dimensions,
          }),
        )
        .expect(200);

      // 3. User makes a purchase
      await request(ctx.app.getHttpServer())
        .post('/api/track')
        .send(
          createSessionPayload({
            session_id: sessionId,
            actions: [
              createGoalAction({
                name: 'purchase',
                value: 99.99,
                page_number: 3,
              }),
            ],
            user_id: userId,
            dimensions,
          }),
        )
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Wait for all tables to be populated
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM events WHERE session_id = '${sessionId}'`,
        4,
      );
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM sessions FINAL WHERE id = '${sessionId}'`,
        1,
      );
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM pages WHERE session_id = '${sessionId}'`,
        3,
      );
      await waitForRowCount(
        workspaceClient,
        `SELECT count() as count FROM goals WHERE session_id = '${sessionId}'`,
        1,
      );

      // 4. Export user events
      const since = new Date(Date.now() - 60000).toISOString();
      const response = await request(ctx.app.getHttpServer())
        .get('/api/export.userEvents')
        .query({
          workspace_id: testWorkspaceId,
          since,
          until: getUntil(),
          user_id: userId,
        })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Should have 3 events (pageview /login, /dashboard, and goal purchase)
      // The anonymous /landing pageview should not be included
      const userEvents = response.body.data.filter(
        (e: { session_id: string }) => e.session_id === sessionId,
      );
      expect(userEvents.length).toBe(3);

      // Verify dimensions are included
      userEvents.forEach((event: Record<string, unknown>) => {
        expect(event.stm_1).toBe('campaign_spring');
        expect(event.stm_2).toBe('variant_a');
        expect(event.stm_3).toBe('segment_premium');
        expect(event.user_id).toBe(userId);
      });

      // Verify goal data
      const goalEvent = userEvents.find(
        (e: { name: string }) => e.name === 'goal',
      );
      expect(goalEvent.goal_name).toBe('purchase');
      expect(goalEvent.goal_value).toBeCloseTo(99.99, 1);

      // 5. Verify session aggregation
      const sessionResult = await workspaceClient.query({
        query: `SELECT user_id, pageview_count, goal_count, goal_value, stm_1
                FROM sessions FINAL WHERE id = {session_id:String}`,
        query_params: { session_id: sessionId },
        format: 'JSONEachRow',
      });
      const [session] = await sessionResult.json();

      // Note: session MV uses any() so will pick up whatever user_id value it sees first
      // The session should have 3 pageviews, 1 goal, and the dimensions
      expect(session.pageview_count).toBe(3);
      expect(session.goal_count).toBe(1);
      expect(session.goal_value).toBeCloseTo(99.99, 1);
    });
  });
});
