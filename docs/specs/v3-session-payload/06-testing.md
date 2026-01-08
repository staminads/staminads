# Phase 6: Testing

**Status**: Ready for Implementation
**Estimated Effort**: 1 day
**Dependencies**: Phase 1-5 (all implementation complete)

## Overview

This phase defines the comprehensive test plan for V3 Session Payload architecture. Testing is organized into four categories:

1. **Unit Tests** - Test individual components in isolation
2. **Integration Tests** - Test component interactions and E2E flows
3. **Load Tests** - Validate performance under stress
4. **Documentation** - API and SDK documentation updates

## Test Summary

| Category | Location | Description |
|----------|----------|-------------|
| Unit: DTOs | `api/src/events/dto/session-payload.dto.spec.ts` | Validation decorators |
| Unit: Handler | `api/src/events/session-payload.handler.spec.ts` | Deserialization, dedup |
| Unit: SessionState | `sdk/src/core/__tests__/session-state.test.ts` | SDK state management |
| Unit: Sender | `sdk/src/transport/__tests__/sender.test.ts` | SDK transport layer |
| Integration: API | `api/test/session-payload.e2e-spec.ts` | E2E endpoint testing |
| Integration: SDK | `sdk/src/__tests__/sdk-session-payload.test.ts` | SDK integration |
| Integration: MV | `api/src/migrations/versions/v3.migration.spec.ts` | MV correctness |
| Load: API | `api/test/load/session-payload.load.js` | Performance testing (k6) |

## Unit Tests

Unit tests are defined in individual phase specs. This section consolidates them and adds cross-cutting tests.

### 1. DTO Validation Tests (Phase 2)

Location: `api/src/events/dto/session-payload.dto.spec.ts`

Tests defined in Phase 2 spec:
- ✅ PageviewAction validation (required fields, ranges)
- ✅ GoalAction validation (required fields, optional properties)
- ✅ SessionPayload validation (workspace_id, session_id, MAX_ACTIONS)
- ✅ Nested action validation (discriminated union)
- ✅ Timestamp bounds validation (±24 hours)
- ✅ SessionAttributes validation (landing_page required)
- ✅ Action type discrimination (type guards)
- ✅ Edge cases (empty strings, unknown types)
- ✅ Pageview timestamp ordering (exited_at >= entered_at)

### 2. Server Handler Tests (Phase 3)

Location: `api/src/events/session-payload.handler.spec.ts`

Tests defined in Phase 3 spec:
- ✅ Pageview deserialization (screen_view event, previous_path)
- ✅ Goal deserialization (goal event, properties)
- ✅ Server timestamp (_version)
- ✅ Checkpoint logic (skip processed, return new checkpoint)
- ✅ current_page handling (ignored)
- ✅ Session attributes (applied to all events)
- ✅ Geo lookup (IP → location)
- ✅ Dedup token generation (deterministic)
- ✅ Error handling (invalid workspace)
- ✅ Filter application

### 3. SDK SessionState Tests (Phase 5)

Location: `sdk/src/core/__tests__/session-state.test.ts`

Tests defined in Phase 5 spec:
- ✅ Initial state
- ✅ Add first pageview
- ✅ Navigation finalizes previous page
- ✅ Add goal action
- ✅ Update scroll
- ✅ Build payload
- ✅ Checkpoint management
- ✅ Finalize for unload
- ✅ Persistence (sessionStorage)
- ✅ MAX_ACTIONS limit

### 4. SDK Integration Tests (Phase 5)

Location: `sdk/src/__tests__/sdk-session-payload.test.ts`

Tests defined in Phase 5 spec:
- ✅ Send triggers (initial, navigation, goal, periodic, unload)
- ✅ Sender methods (sendSession, sendSessionBeacon)
- ✅ Back-forward cache restore
- ✅ Error handling
- ✅ ScrollTracker integration
- ✅ Concurrent action safety

### 5. Cross-Cutting Unit Tests (New)

Additional tests for edge cases not covered in individual phases.

#### DTO Validation Tests

Add to `api/src/events/dto/session-payload.dto.spec.ts`:

```typescript
describe('Cross-phase validation - payload size', () => {
  it('rejects payload with actions exceeding MAX_ACTIONS', async () => {
    const MAX_ACTIONS = 1000;
    const actions = Array(MAX_ACTIONS + 1).fill(null).map((_, i) => ({
      type: 'pageview',
      path: `/page-${i}`,
      page_number: i + 1,
      duration: 1000,
      scroll: 50,
      entered_at: Date.now() - 1000,
      exited_at: Date.now(),
    }));

    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws',
      session_id: 'sess',
      actions,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'actions')).toBe(true);
  });

  it('accepts payload with exactly MAX_ACTIONS', async () => {
    const MAX_ACTIONS = 1000;
    const actions = Array(MAX_ACTIONS).fill(null).map((_, i) => ({
      type: 'pageview',
      path: `/page-${i}`,
      page_number: i + 1,
      duration: 1000,
      scroll: 50,
      entered_at: Date.now() - 1000,
      exited_at: Date.now(),
    }));

    const dto = plainToInstance(SessionPayloadDto, {
      workspace_id: 'ws',
      session_id: 'sess',
      actions,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
```

#### Handler Tests

Add to `api/src/events/session-payload.handler.spec.ts`:

```typescript
describe('Cross-phase validation - action processing', () => {
  it('preserves action order in payload', async () => {
    const payload = createPayload({
      actions: [
        createPageviewAction({ path: '/a', page_number: 1 }),
        createGoalAction({ name: 'goal1' }),
        createPageviewAction({ path: '/b', page_number: 2 }),
        createGoalAction({ name: 'goal2' }),
      ],
      attributes: { landing_page: 'https://example.com/' },
    });

    await handler.handle(payload, null);

    const events = bufferService.addBatch.mock.calls[0][0];
    expect(events).toHaveLength(4);
    expect(events.map(e => e.path || e.goal_name)).toEqual([
      '/a', 'goal1', '/b', 'goal2'
    ]);
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
    expect(events.filter(e => e.name === 'screen_view')).toHaveLength(2);
    expect(events.filter(e => e.name === 'goal')).toHaveLength(3);
  });
});
```

## Integration Tests

### 1. E2E Session Payload Tests (New)

Location: `api/test/session-payload.e2e-spec.ts`

```typescript
// Set env vars BEFORE any imports
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

  const createSessionPayload = (overrides: Record<string, any> = {}) => ({
    workspace_id: testWorkspaceId,
    session_id: `sess-${Date.now()}`,
    actions: [],
    created_at: Date.now() - 10000,
    updated_at: Date.now(),
    ...overrides,
  });

  const createPageviewAction = (overrides: Record<string, any> = {}) => ({
    type: 'pageview',
    path: '/home',
    page_number: 1,
    duration: 5000,
    scroll: 50,
    entered_at: Date.now() - 5000,
    exited_at: Date.now(),
    ...overrides,
  });

  const createGoalAction = (overrides: Record<string, any> = {}) => ({
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
    await truncateWorkspaceTables(workspaceClient, ['events', 'sessions', 'pages']);
    await createTestWorkspace(systemClient, testWorkspaceId);
    apiKey = await createTestApiKey(systemClient, testWorkspaceId);
  });

  describe('POST /api/track.session', () => {
    it('accepts valid session payload', async () => {
      const payload = createSessionPayload({
        actions: [createPageviewAction()],
        attributes: {
          landing_page: 'https://example.com/home',
          browser: 'Chrome',
        },
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/api/track.session')
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
        .post('/api/track.session')
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
      expect(events[0]).toMatchObject({ name: 'goal', goal_name: 'signup' });
      expect(events[1]).toMatchObject({ name: 'screen_view', path: '/home' });
      expect(events[2]).toMatchObject({ name: 'screen_view', path: '/dashboard' });
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
        .post('/api/track.session')
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
          createPageviewAction({ path: '/page3', page_number: 3 }),  // New
          createPageviewAction({ path: '/page4', page_number: 4 }),  // New
        ],
        checkpoint: 2,  // Skip first 2
        // No attributes - already sent
      });

      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/track.session')
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
        .post('/api/track.session')
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
        .post('/api/track.session')
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

      expect(event.dedup_token).toBe('sess-dedup-goal_goal_purchase_1704067200000');
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
        .post('/api/track.session')
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
        .post('/api/track.session')
        .send(payload)
        .expect(401);
    });

    it('rejects invalid workspace_id', async () => {
      const payload = createSessionPayload({
        workspace_id: 'invalid-ws',
        actions: [createPageviewAction()],
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(403);
    });

    it('validates nested actions', async () => {
      const payload = createSessionPayload({
        actions: [{
          type: 'pageview',
          // Missing required fields
        }],
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('rejects unknown action type', async () => {
      const payload = createSessionPayload({
        actions: [{
          type: 'unknown_type',
          path: '/test',
        }],
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track.session')
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
          createPageviewAction({ path: '/home', page_number: 1, duration: 5000 }),
          createPageviewAction({ path: '/about', page_number: 2, duration: 3000 }),
        ],
        attributes: { landing_page: 'https://example.com/home' },  // landing_path derived by server
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Wait for MV to process
      await waitForRowCount(
        workspaceClient,
        `SELECT count() FROM pages WHERE session_id = '${sessionId}'`,
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
        is_landing: 1,  // '/home' matches landing_path derived from landing_page URL
      });
      expect(pages[1]).toMatchObject({
        page_id: `${sessionId}_2`,
        path: '/about',
        page_number: 2,
        is_landing: 0,
      });
    });

    it('deduplicates pages with FINAL (ReplacingMergeTree)', async () => {
      const sessionId = `sess-pages-dedup-${Date.now()}`;

      // First payload
      const payload1 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/page', page_number: 1, duration: 5000, scroll: 30 }),
        ],
        attributes: { landing_page: 'https://example.com/' },
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload1)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      // Second payload - same page, updated values
      const payload2 = createSessionPayload({
        session_id: sessionId,
        actions: [
          createPageviewAction({ path: '/page', page_number: 1, duration: 15000, scroll: 85 }),
        ],
        // No attributes (already sent), no checkpoint (testing dedup)
      });

      await request(ctx.app.getHttpServer())
        .post('/api/track.session')
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
      expect(pages[0].duration).toBe(15000);  // Latest value
      expect(pages[0].max_scroll).toBe(85);   // Latest value
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
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() FROM pages WHERE session_id = '${sessionId}'`,
        1,  // Only 1 page (from pageview), not 3
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
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() FROM sessions FINAL WHERE id = '${sessionId}'`,
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
        .post('/api/track.session')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(payload)
        .expect(200);

      await eventBuffer.flushAll();
      await waitForClickHouse();

      await waitForRowCount(
        workspaceClient,
        `SELECT count() FROM sessions FINAL WHERE id = '${sessionId}'`,
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
```

### 2. Migration Tests (Phase 4)

Location: `api/src/migrations/versions/v3.migration.spec.ts`

Tests defined in Phase 4 spec. Additional cross-phase tests:

```typescript
describe('V3 Migration - Cross-Phase', () => {
  it('full flow: SDK payload → events → pages_mv → sessions_mv', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Simulate SDK payload events
    const events = [
      // Page 1: /home (5s, 50% scroll)
      createTestEvent({
        session_id: 'full-flow',
        page_number: 1,
        name: 'screen_view',
        path: '/home',
        page_duration: 5000,
        max_scroll: 50,
        landing_path: '/home',
      }),
      // Goal on page 1
      createTestEvent({
        session_id: 'full-flow',
        page_number: 1,
        name: 'goal',
        path: '/home',
        page_duration: 0,
        goal_name: 'signup',
        goal_value: 0,
      }),
      // Page 2: /dashboard (10s, 75% scroll)
      createTestEvent({
        session_id: 'full-flow',
        page_number: 2,
        name: 'screen_view',
        path: '/dashboard',
        page_duration: 10000,
        max_scroll: 75,
        landing_path: '/home',
      }),
    ];

    await client.insert({
      table: `${workspaceDb}.events`,
      values: events,
      format: 'JSONEachRow',
    });

    // Verify pages
    const pagesResult = await client.query({
      query: `SELECT path, page_number FROM ${workspaceDb}.pages FINAL ORDER BY page_number`,
    });
    const pages = await pagesResult.json();

    expect(pages.data).toHaveLength(2);  // 2 pageviews, goals excluded
    expect(pages.data[0].path).toBe('/home');
    expect(pages.data[1].path).toBe('/dashboard');

    // Verify session
    const sessResult = await client.query({
      query: `SELECT pageview_count, goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 'full-flow'`,
    });
    const sessions = await sessResult.json();

    expect(sessions.data[0].pageview_count).toBe(2);
    expect(sessions.data[0].goal_count).toBe(1);
  });
});
```

## Load Tests

Location: `api/test/load/session-payload.load.ts`

Use k6 or Artillery for load testing. Example k6 script:

```javascript
// api/test/load/session-payload.load.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  scenarios: {
    // Scenario 1: Normal load
    normal_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '1m',
      exec: 'normalPayload',
    },
    // Scenario 2: Large payloads
    large_payloads: {
      executor: 'constant-vus',
      vus: 5,
      duration: '1m',
      exec: 'largePayload',
      startTime: '1m',
    },
    // Scenario 3: Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      exec: 'normalPayload',
      startTime: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],     // Less than 1% failure rate
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || 'test-api-key';
const WORKSPACE_ID = __ENV.WORKSPACE_ID || 'load-test-ws';

function createPageviewAction(pageNumber) {
  return {
    type: 'pageview',
    path: `/page-${pageNumber}`,
    page_number: pageNumber,
    duration: Math.floor(Math.random() * 30000) + 1000,
    scroll: Math.floor(Math.random() * 100),
    entered_at: Date.now() - 5000,
    exited_at: Date.now(),
  };
}

function createGoalAction(name, pageNumber) {
  return {
    type: 'goal',
    name: name,
    path: `/page-${pageNumber}`,
    page_number: pageNumber,
    timestamp: Date.now(),
    value: Math.random() * 100,
  };
}

// Normal payload: 3-5 pageviews, 0-2 goals
export function normalPayload() {
  const sessionId = `load-${randomString(8)}`;
  const numPageviews = Math.floor(Math.random() * 3) + 3;
  const numGoals = Math.floor(Math.random() * 3);

  const actions = [];
  for (let i = 1; i <= numPageviews; i++) {
    actions.push(createPageviewAction(i));
    if (i <= numGoals) {
      actions.push(createGoalAction(`goal_${i}`, i));
    }
  }

  const payload = {
    workspace_id: WORKSPACE_ID,
    session_id: sessionId,
    actions: actions,
    attributes: {
      landing_page: 'https://example.com/landing',
      browser: 'Chrome',
      os: 'macOS',
    },
    created_at: Date.now() - 60000,
    updated_at: Date.now(),
  };

  const response = http.post(
    `${BASE_URL}/api/track.session`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
    }
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'success is true': (r) => JSON.parse(r.body).success === true,
    'checkpoint returned': (r) => JSON.parse(r.body).checkpoint !== undefined,
  });

  sleep(0.1);
}

// Large payload: 500 actions (stress test MAX_ACTIONS limit)
export function largePayload() {
  const sessionId = `load-large-${randomString(8)}`;
  const numActions = 500;

  const actions = [];
  for (let i = 1; i <= numActions; i++) {
    actions.push(createPageviewAction(i));
  }

  const payload = {
    workspace_id: WORKSPACE_ID,
    session_id: sessionId,
    actions: actions,
    attributes: {
      landing_page: 'https://example.com/landing',
    },
    created_at: Date.now() - 60000,
    updated_at: Date.now(),
  };

  const response = http.post(
    `${BASE_URL}/api/track.session`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      timeout: '30s',
    }
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'all actions processed': (r) => JSON.parse(r.body).checkpoint === numActions,
  });

  sleep(1);
}
```

### Load Test Execution

```bash
# Install k6
brew install k6

# Run load tests
cd api/test/load
k6 run session-payload.load.js \
  -e API_URL=http://localhost:3000 \
  -e API_KEY=<your-api-key> \
  -e WORKSPACE_ID=<workspace-id>

# With HTML report
k6 run session-payload.load.js --out json=results.json
```

### Load Test Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| `http_req_duration` p95 | < 500ms | 95th percentile response time |
| `http_req_failed` | < 1% | Error rate |
| `http_reqs` | > 100/s | Throughput |
| `iterations` | Completes | All scenarios complete |

## Documentation Updates

### 1. OpenAPI Spec Update

Add the new endpoint to the API documentation:

```typescript
// api/src/events/events.controller.ts

@Post('track.session')
@HttpCode(200)
@ApiOperation({ summary: 'Track session with cumulative actions array (V3)' })
@ApiBody({ type: SessionPayloadDto })
@ApiResponse({
  status: 200,
  description: 'Session payload processed successfully',
  schema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      checkpoint: { type: 'number', example: 5 },
    },
  },
})
@ApiResponse({ status: 400, description: 'Validation error' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 403, description: 'Forbidden - Invalid workspace or scope' })
async trackSession(
  @Body() payload: SessionPayloadDto,
  @ClientIp() clientIp: string | null,
) {
  return this.sessionPayloadHandler.handle(payload, clientIp);
}
```

### 2. SDK Documentation

Update SDK README with new payload format:

```markdown
## V3 Session Payload (SDK 6.0+)

The SDK now uses a cumulative `actions[]` array instead of individual events.

### How It Works

1. **Session State**: SDK maintains an in-memory `actions[]` array
2. **Pageview Tracking**: On navigation, the previous page is finalized and added to `actions[]`
3. **Goal Tracking**: Goals are added to `actions[]` immediately
4. **Send Triggers**:
   - Initial pageview → immediate
   - Navigation → debounced (100ms)
   - Goal → **immediate** (time-sensitive)
   - Periodic → every 30s
   - Unload → sendBeacon

### Checkpoint System

For efficient network usage, the SDK tracks a `checkpoint` from server responses:
- Server returns `checkpoint` = number of actions processed
- SDK includes `checkpoint` in subsequent payloads
- Server skips actions at indices ≤ checkpoint

### Example Payload

```json
{
  "workspace_id": "ws-123",
  "session_id": "sess-abc",
  "actions": [
    {
      "type": "pageview",
      "path": "/home",
      "page_number": 1,
      "duration": 5000,
      "scroll": 75,
      "entered_at": 1704067200000,
      "exited_at": 1704067205000
    },
    {
      "type": "goal",
      "name": "signup",
      "path": "/home",
      "page_number": 1,
      "timestamp": 1704067203000
    }
  ],
  "current_page": {
    "path": "/dashboard",
    "page_number": 2,
    "entered_at": 1704067205000,
    "scroll": 25
  },
  "checkpoint": 0,
  "attributes": {
    "landing_page": "https://example.com/home",
    "browser": "Chrome"
  },
  "created_at": 1704067200000,
  "updated_at": 1704067210000,
  "sdk_version": "6.0.0"
}
```
```

## Test Execution Plan

### Pre-Implementation Checklist

- [ ] Phase 1-5 implementation complete
- [ ] ClickHouse running with V3 migration applied
- [ ] Test environment configured (`.env.test`)

### Unit Test Execution

```bash
# API unit tests
cd api
npm test -- session-payload.dto
npm test -- session-payload.handler
npm test -- v3.migration

# SDK unit tests
cd sdk
npm test -- session-state
npm test -- sender
npm test -- sdk-session-payload
```

### Integration Test Execution

```bash
# E2E tests (requires ClickHouse)
cd api
npm run test:e2e -- session-payload
```

### Load Test Execution

```bash
# Run load tests
cd api/test/load
k6 run session-payload.load.js -e API_URL=http://localhost:3000
```

### Manual Testing Checklist

Browser testing with actual SDK:

- [ ] Initial pageview sends immediately with attributes
- [ ] Navigation debounces correctly (100ms)
- [ ] Rapid navigations batched into single send
- [ ] Goals send immediately (no debounce)
- [ ] Goals cancel pending debounced send
- [ ] Heartbeat sends periodic updates with scroll
- [ ] Unload finalizes currentPage and sends via beacon
- [ ] Page reload restores state from sessionStorage
- [ ] Back-forward cache restores state
- [ ] Checkpoint updates correctly from server response
- [ ] Attributes only sent on first payload
- [ ] MAX_ACTIONS limit enforced (1000)
- [ ] Error handling doesn't lose data

### Acceptance Criteria

| Criterion | Test | Expected |
|-----------|------|----------|
| All unit tests pass | `npm test` | 100% pass |
| All E2E tests pass | `npm run test:e2e` | 100% pass |
| Load test p95 latency | k6 results | < 500ms |
| Load test error rate | k6 results | < 1% |
| Manual browser tests | Checklist | All pass |

## Checklist

### Unit Tests
- [ ] All Phase 2 DTO tests passing
- [ ] All Phase 3 handler tests passing
- [ ] All Phase 4 MV tests passing
- [ ] All Phase 5 SDK tests passing
- [ ] Cross-cutting tests added and passing

### Integration Tests
- [ ] Create `api/test/session-payload.e2e-spec.ts`
- [ ] E2E endpoint tests passing
- [ ] Pages MV integration tests passing
- [ ] Sessions MV integration tests passing
- [ ] Checkpoint flow tested end-to-end

### Load Tests
- [ ] Create `api/test/load/session-payload.load.js`
- [ ] Normal load scenario passes thresholds
- [ ] Large payload scenario passes thresholds
- [ ] Spike test scenario passes thresholds

### Documentation
- [ ] OpenAPI spec updated with `/api/track.session`
- [ ] SDK README updated with V3 payload format
- [ ] API docs regenerated (`npm run openapi:generate`)

### Final Verification
- [ ] All tests pass in CI
- [ ] Manual browser testing complete
- [ ] Performance metrics meet targets
- [ ] Documentation reviewed
