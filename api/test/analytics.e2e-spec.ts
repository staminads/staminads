// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import {
  toClickHouseDateTime,
  createUserWithToken,
  createTestWorkspace,
  truncateSystemTables,
  truncateWorkspaceTables,
  createTestApp,
  closeTestApp,
  waitForClickHouse,
  TestAppContext,
} from './helpers';

// Workspace ID used in tests
const testWorkspaceId = 'analytics_test_ws';

describe('Analytics E2E', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let authToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ workspaceId: testWorkspaceId });
    systemClient = ctx.systemClient;
    workspaceClient = ctx.workspaceClient!;

    // Clean users table first to avoid duplicates
    await truncateSystemTables(systemClient, ['users']);

    // Create test user for this test suite (uses default TEST_PASSWORD)
    const { token } = await createUserWithToken(
      ctx.app,
      systemClient,
      'analytics-test@test.com',
      undefined,
      { name: 'Analytics Test User', isSuperAdmin: true },
    );
    authToken = token;

    // Create test workspace in system database
    workspaceId = testWorkspaceId;
    await truncateSystemTables(systemClient, ['workspaces'], 0);
    await truncateWorkspaceTables(
      workspaceClient,
      ['sessions', 'pages', 'goals'],
      0,
    );

    await createTestWorkspace(systemClient, workspaceId, {
      name: 'Analytics Test Workspace',
      website: 'https://test.com',
    });

    // Seed test sessions in workspace database
    const baseDate = new Date('2025-12-01T12:00:00Z');
    const sessions = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + Math.floor(i / 3));

      sessions.push({
        id: `session-${i}`,
        workspace_id: workspaceId,
        created_at: toClickHouseDateTime(date),
        updated_at: toClickHouseDateTime(date),
        duration: 30 + i * 5,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        day_of_week: date.getDay() || 7,
        week_number: 1,
        hour: date.getHours(),
        is_weekend: date.getDay() === 0 || date.getDay() === 6,
        referrer: null,
        referrer_domain: null,
        referrer_path: null,
        is_direct: true,
        landing_page: 'https://test.com/',
        landing_domain: 'test.com',
        landing_path: '/',
        entry_page: '/',
        exit_page: '/contact',
        utm_source: i % 2 === 0 ? 'google' : 'facebook',
        utm_medium: 'cpc',
        utm_campaign: i % 3 === 0 ? 'summer' : 'winter',
        utm_term: null,
        utm_content: null,
        utm_id: null,
        utm_id_from: null,
        channel:
          i % 3 === 0 ? 'Paid Search' : i % 3 === 1 ? 'Social' : 'Direct',
        channel_group:
          i % 3 === 0
            ? 'search-paid'
            : i % 3 === 1
              ? 'social-organic'
              : 'direct',
        screen_width: 1920,
        screen_height: 1080,
        viewport_width: 1920,
        viewport_height: 900,
        user_agent: 'Mozilla/5.0',
        language: 'en-US',
        timezone: 'America/New_York',
        browser: 'Chrome',
        browser_type: 'browser',
        os: 'macOS',
        device: i % 2 === 0 ? 'desktop' : 'mobile',
        connection_type: 'wifi',
        max_scroll: 50 + i,
        sdk_version: '1.0.0',
      });
    }

    await workspaceClient.insert({
      table: 'sessions',
      values: sessions,
      format: 'JSONEachRow',
    });

    // Seed test pages in workspace database
    // Use recent dates to avoid 7-day TTL on pages table
    const pagesBaseDate = new Date();
    pagesBaseDate.setDate(pagesBaseDate.getDate() - 3); // 3 days ago to stay within TTL
    const pages = [];
    const pagePaths = ['/', '/products', '/about', '/contact', '/blog'];
    for (let i = 0; i < 50; i++) {
      const date = new Date(pagesBaseDate);
      date.setHours(date.getHours() + Math.floor(i / 5)); // Spread pages over hours instead of days
      const path = pagePaths[i % pagePaths.length];

      pages.push({
        id: `00000000-0000-0000-0000-0000000000${i.toString().padStart(2, '0')}`,
        session_id: `session-${Math.floor(i / 2)}`,
        workspace_id: workspaceId,
        path: path,
        full_url: `https://test.com${path}`,
        entered_at: toClickHouseDateTime(date),
        exited_at: toClickHouseDateTime(
          new Date(date.getTime() + (30 + i * 2) * 1000),
        ),
        duration: 30 + i * 2,
        max_scroll: 20 + (i % 80),
        page_number: (i % 2) + 1, // 1 or 2 per session (session_id cycles every 2)
        is_landing: i % 5 === 0,
        is_exit: i % 5 === 4,
        entry_type: i % 5 === 0 ? 'landing' : 'navigation',
        received_at: toClickHouseDateTime(date),
      });
    }

    await workspaceClient.insert({
      table: 'pages',
      values: pages,
      format: 'JSONEachRow',
    });

    // Force merge for ReplacingMergeTree to ensure FINAL works correctly in tests
    await workspaceClient.command({
      query: 'OPTIMIZE TABLE pages FINAL',
    });

    // Seed test goals in workspace database
    const goals = [];
    const goalNames = ['add_to_cart', 'checkout_start', 'purchase'];
    for (let i = 0; i < 30; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + Math.floor(i / 3));
      const goalName = goalNames[i % goalNames.length];
      const hasValue = goalName === 'purchase';

      goals.push({
        id: `00000000-0000-0001-0000-0000000000${i.toString().padStart(2, '0')}`,
        session_id: `session-${Math.floor(i / 2)}`,
        workspace_id: workspaceId,
        goal_name: goalName,
        goal_value: hasValue ? 99.99 + i : 0,
        goal_timestamp: toClickHouseDateTime(date),
        path: '/products',
        page_number: 1,
        properties: {},
        referrer: '',
        referrer_domain: '',
        is_direct: true,
        landing_page: 'https://test.com/',
        landing_path: '/',
        utm_source: i % 2 === 0 ? 'google' : 'facebook',
        utm_medium: 'cpc',
        utm_campaign: i % 3 === 0 ? 'summer' : 'winter',
        utm_term: '',
        utm_content: '',
        channel:
          i % 3 === 0 ? 'Paid Search' : i % 3 === 1 ? 'Social' : 'Direct',
        channel_group:
          i % 3 === 0
            ? 'search-paid'
            : i % 3 === 1
              ? 'social-organic'
              : 'direct',
        stm_1: '',
        stm_2: '',
        stm_3: '',
        stm_4: '',
        stm_5: '',
        stm_6: '',
        stm_7: '',
        stm_8: '',
        stm_9: '',
        stm_10: '',
        device: i % 2 === 0 ? 'desktop' : 'mobile',
        browser: 'Chrome',
        os: 'macOS',
        country: 'US',
        region: 'CA',
        city: 'San Francisco',
        language: 'en-US',
        _version: 1,
      });
    }

    await workspaceClient.insert({
      table: 'goals',
      values: goals,
      format: 'JSONEachRow',
    });

    await waitForClickHouse(200);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  describe('POST /api/analytics.query', () => {
    it('returns sessions count with no dimensions', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(Number(response.body.data[0].sessions)).toBe(30);
      expect(response.body.meta.metrics).toEqual(['sessions']);
    });

    it('includes multiple metrics', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'avg_duration'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('sessions');
      expect(response.body.data[0]).toHaveProperty('avg_duration');
      expect(Number(response.body.data[0].sessions)).toBe(30);
    });

    it('groups by dimension', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(1);
      expect(response.body.data[0]).toHaveProperty('device');

      // Verify both device types are present
      const devices = response.body.data.map(
        (d: { device: string }) => d.device,
      );
      expect(devices).toContain('desktop');
      expect(devices).toContain('mobile');
    });

    it('groups by multiple dimensions', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['device', 'channel'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('device');
      expect(response.body.data[0]).toHaveProperty('channel');
    });

    it('applies filters correctly', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          filters: [
            { dimension: 'device', operator: 'equals', values: ['mobile'] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(Number(response.body.data[0].sessions)).toBe(15); // Half are mobile
    });

    it('applies in filter correctly', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          filters: [
            { dimension: 'utm_source', operator: 'in', values: ['google'] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(Number(response.body.data[0].sessions)).toBe(15); // Half are google
    });

    it('returns time series with granularity', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: {
            start: '2025-12-01',
            end: '2025-12-10',
            granularity: 'day',
          },
        })
        .expect(200);

      expect(response.body.data.length).toBe(10); // 10 days with gaps filled
      expect(response.body.data[0]).toHaveProperty('date_day');
    });

    it('fills gaps with zeros', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: {
            start: '2025-12-01',
            end: '2025-12-15',
            granularity: 'day',
          },
        })
        .expect(200);

      // Check that we have 15 days
      expect(response.body.data.length).toBe(15);

      // Days without data should have 0 sessions
      const dec14 = response.body.data.find(
        (d: { date_day: string }) => d.date_day === '2025-12-14',
      );
      expect(Number(dec14?.sessions)).toBe(0);
    });

    it('resolves date preset', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: { preset: 'previous_30_days' },
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('respects custom order', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
          order: { sessions: 'asc' },
        })
        .expect(200);

      // First row should have fewer sessions
      expect(Number(response.body.data[0].sessions)).toBeLessThanOrEqual(
        Number(response.body.data[1].sessions),
      );
    });

    it('respects limit', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['channel'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
          limit: 1,
        })
        .expect(200);

      expect(response.body.data.length).toBe(1);
    });

    it('returns comparison data', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-15' },
          compareDateRange: { start: '2025-11-15', end: '2025-11-30' },
        })
        .expect(200);

      expect(response.body.data.current).toBeDefined();
      expect(response.body.data.previous).toBeDefined();
      expect(Array.isArray(response.body.data.current)).toBe(true);
    });

    it('validates unknown metric', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['invalid_metric'],
          dateRange: { start: '2025-12-01', end: '2025-12-28' },
        })
        .expect(400);
    });

    it('validates unknown dimension', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['invalid_dimension'],
          dateRange: { start: '2025-12-01', end: '2025-12-28' },
        })
        .expect(400);
    });

    it('validates unknown workspace', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: 'non-existent-workspace',
          metrics: ['sessions'],
          dateRange: { start: '2025-12-01', end: '2025-12-28' },
        })
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: { start: '2025-12-01', end: '2025-12-28' },
        })
        .expect(401);
    });

    it('returns SQL in response for debugging', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.query).toBeDefined();
      expect(response.body.query.sql).toContain('SELECT');
      expect(response.body.query.sql).toContain('sessions FINAL');
      expect(response.body.query.params).toBeDefined();
    });
  });

  describe('GET /api/analytics.metrics', () => {
    it('returns available metrics', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/analytics.metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(
        response.body.find((m: { name: string }) => m.name === 'sessions'),
      ).toBeDefined();
      expect(
        response.body.find((m: { name: string }) => m.name === 'avg_duration'),
      ).toBeDefined();
      expect(
        response.body.find((m: { name: string }) => m.name === 'bounce_rate'),
      ).toBeDefined();
    });
  });

  describe('GET /api/analytics.dimensions', () => {
    it('returns available dimensions', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/analytics.dimensions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Dimensions are returned as a Record<string, DimensionDefinition>
      expect(typeof response.body).toBe('object');
      expect(response.body.channel).toBeDefined();
      expect(response.body.channel_group).toBeDefined();
      expect(response.body.device).toBeDefined();
      expect(response.body.utm_source).toBeDefined();
    });
  });

  describe('POST /api/analytics.extremes', () => {
    it('returns min and max values', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'median_duration',
          groupBy: ['utm_source'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body).toHaveProperty('min');
      expect(response.body).toHaveProperty('max');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta.metric).toBe('median_duration');
      expect(response.body.meta.groupBy).toEqual(['utm_source']);
      expect(typeof response.body.min).toBe('number');
      expect(typeof response.body.max).toBe('number');
      expect(response.body.max).toBeGreaterThanOrEqual(response.body.min);
    });

    it('returns extremes for sessions metric', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'sessions',
          groupBy: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(Number(response.body.min)).toBe(15);
      expect(Number(response.body.max)).toBe(15);
    });

    it('applies filters correctly', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'sessions',
          groupBy: ['utm_campaign'],
          filters: [
            { dimension: 'device', operator: 'equals', values: ['mobile'] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body).toHaveProperty('min');
      expect(response.body).toHaveProperty('max');
    });

    it('resolves date preset', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'median_duration',
          groupBy: ['channel'],
          dateRange: { preset: 'previous_30_days' },
        })
        .expect(200);

      expect(response.body.meta.dateRange.start).toBeDefined();
      expect(response.body.meta.dateRange.end).toBeDefined();
    });

    it('handles multiple groupBy dimensions', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'sessions',
          groupBy: ['device', 'channel'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body).toHaveProperty('min');
      expect(response.body).toHaveProperty('max');
      expect(response.body.meta.groupBy).toEqual(['device', 'channel']);
    });

    it('returns 0 for empty result', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'median_duration',
          groupBy: ['utm_source'],
          dateRange: { start: '1990-01-01', end: '1990-01-02' },
        })
        .expect(200);

      // ClickHouse MIN/MAX returns 0 for empty aggregations
      expect(response.body.min).toBe(0);
      expect(response.body.max).toBe(0);
    });

    it('rejects unknown metric', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'unknown_metric',
          groupBy: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(400);
    });

    it('rejects unknown dimension in groupBy', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'sessions',
          groupBy: ['unknown_dimension'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(400);
    });

    it('rejects empty groupBy array', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'sessions',
          groupBy: [],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .send({
          workspace_id: workspaceId,
          metric: 'median_duration',
          groupBy: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(401);
    });
  });

  describe('Analytics Caching', () => {
    it('returns cached response for identical queries', async () => {
      const query = {
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dateRange: { start: '2025-12-01', end: '2025-12-10' },
      };

      // First request - should hit database
      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      // Second identical request - should return cached response
      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      // Both responses should be identical
      expect(response1.body.data).toEqual(response2.body.data);
      expect(response1.body.meta).toEqual(response2.body.meta);
    });

    it('returns different responses for different queries', async () => {
      const query1 = {
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dateRange: { start: '2025-12-01', end: '2025-12-05' },
      };

      const query2 = {
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dateRange: { start: '2025-12-01', end: '2025-12-10' },
      };

      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query1)
        .expect(200);

      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query2)
        .expect(200);

      // Different date ranges should produce different meta
      expect(response1.body.meta.dateRange.end).not.toEqual(
        response2.body.meta.dateRange.end,
      );
    });

    it('caches queries with different metrics separately', async () => {
      const baseQuery = {
        workspace_id: workspaceId,
        dateRange: { start: '2025-12-01', end: '2025-12-10' },
      };

      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ...baseQuery, metrics: ['sessions'] })
        .expect(200);

      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ...baseQuery, metrics: ['avg_duration'] })
        .expect(200);

      // Different metrics means different queries
      expect(response1.body.meta.metrics).toEqual(['sessions']);
      expect(response2.body.meta.metrics).toEqual(['avg_duration']);
    });

    it('caches queries with different filters separately', async () => {
      const baseQuery = {
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dateRange: { start: '2025-12-01', end: '2025-12-31' },
      };

      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...baseQuery,
          filters: [
            { dimension: 'device', operator: 'equals', values: ['desktop'] },
          ],
        })
        .expect(200);

      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...baseQuery,
          filters: [
            { dimension: 'device', operator: 'equals', values: ['mobile'] },
          ],
        })
        .expect(200);

      // Different filters should return different session counts (15 each)
      expect(Number(response1.body.data[0].sessions)).toBe(15); // desktop
      expect(Number(response2.body.data[0].sessions)).toBe(15); // mobile
    });

    it('handles concurrent identical requests efficiently', async () => {
      const query = {
        workspace_id: workspaceId,
        metrics: ['sessions', 'avg_duration'],
        dimensions: ['device'],
        dateRange: { start: '2025-12-01', end: '2025-12-15' },
      };

      // Fire 5 identical requests concurrently
      const responses = await Promise.all([
        request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
      ]);

      // All should succeed with identical results
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(responses[0].body.data);
      }
    });

    it('caches queries with granularity correctly', async () => {
      const query = {
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dateRange: {
          start: '2025-12-01',
          end: '2025-12-05',
          granularity: 'day',
        },
      };

      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      // Same query should return cached result
      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      expect(response1.body.data).toEqual(response2.body.data);
      expect(response1.body.meta.granularity).toBe('day');
    });
  });

  describe('Pages Table Analytics', () => {
    // Pages table has 7-day TTL, so we use dynamic date ranges
    const getPagesDateRange = () => {
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 7);
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    };

    describe('POST /api/analytics.query with table=pages', () => {
      it('returns page count from pages table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count'],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(Number(response.body.data[0].page_count)).toBe(50);
      });

      it('returns page metrics grouped by page_path', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count', 'page_duration'],
            dimensions: ['page_path'],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(response.body.data.length).toBe(5); // 5 different paths
        expect(response.body.data[0]).toHaveProperty('path');
        expect(response.body.data[0]).toHaveProperty('page_count');
        expect(response.body.data[0]).toHaveProperty('page_duration');

        // Each path should have 10 pages (50 total / 5 paths)
        const paths = response.body.data.map((d: { path: string }) => d.path);
        expect(paths).toContain('/');
        expect(paths).toContain('/products');
        expect(paths).toContain('/about');
      });

      it('returns median duration per page', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_duration', 'page_scroll'],
            dimensions: ['page_path'],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        // Verify we get median values (not averages)
        expect(response.body.data[0]).toHaveProperty('page_duration');
        expect(response.body.data[0]).toHaveProperty('page_scroll');
        expect(typeof response.body.data[0].page_duration).toBe('number');
      });

      it('filters pages by page_path', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count'],
            filters: [
              {
                dimension: 'page_path',
                operator: 'equals',
                values: ['/products'],
              },
            ],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(Number(response.body.data[0].page_count)).toBe(10);
      });

      it('filters pages by is_landing_page', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count'],
            filters: [
              {
                dimension: 'is_landing_page',
                operator: 'equals',
                values: [true],
              },
            ],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(Number(response.body.data[0].page_count)).toBe(10); // 50 pages, every 5th is landing
      });

      it('returns landing and exit page counts', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['landing_page_count', 'exit_page_count', 'exit_rate'],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(Number(response.body.data[0].landing_page_count)).toBe(10);
        expect(Number(response.body.data[0].exit_page_count)).toBe(10);
        expect(Number(response.body.data[0].exit_rate)).toBe(20); // 10/50 * 100 = 20%
      });

      it('returns time series with granularity for pages', async () => {
        const dateRange = getPagesDateRange();
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count'],
            dateRange: {
              ...dateRange,
              granularity: 'day',
            },
          })
          .expect(200);

        // Verify we get time series data with date_day property
        expect(response.body.data.length).toBeGreaterThan(0);
        expect(response.body.data[0]).toHaveProperty('date_day');
      });

      it('validates sessions metric not available on pages table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['sessions'],
            dateRange: getPagesDateRange(),
          })
          .expect(400);
      });

      it('validates sessions dimension not available on pages table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count'],
            dimensions: ['utm_source'],
            dateRange: getPagesDateRange(),
          })
          .expect(400);
      });

      it('validates page_count metric not available on sessions table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'sessions',
            metrics: ['page_count'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(400);
      });

      it('validates page_path dimension not available on sessions table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'sessions',
            metrics: ['sessions'],
            dimensions: ['page_path'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(400);
      });

      it('returns SQL with FINAL for pages table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metrics: ['page_count'],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(response.body.query.sql).toContain('FROM pages FINAL');
      });
    });

    describe('POST /api/analytics.extremes with table=pages', () => {
      it('returns min and max page duration by path', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.extremes')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metric: 'page_duration',
            groupBy: ['page_path'],
            dateRange: getPagesDateRange(),
          })
          .expect(200);

        expect(response.body).toHaveProperty('min');
        expect(response.body).toHaveProperty('max');
        expect(response.body.meta.metric).toBe('page_duration');
      });

      it('validates sessions metric not available on pages table for extremes', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.extremes')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'pages',
            metric: 'sessions',
            groupBy: ['page_path'],
            dateRange: getPagesDateRange(),
          })
          .expect(400);
      });
    });

    describe('GET /api/analytics.metrics with table filter', () => {
      it('returns all metrics without table filter', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.metrics')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const metricNames = response.body.map((m: { name: string }) => m.name);
        expect(metricNames).toContain('sessions');
        expect(metricNames).toContain('page_count');
      });

      it('returns only sessions metrics with table=sessions', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.metrics?table=sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const metricNames = response.body.map((m: { name: string }) => m.name);
        expect(metricNames).toContain('sessions');
        expect(metricNames).toContain('avg_duration');
        expect(metricNames).not.toContain('page_count');
        expect(metricNames).not.toContain('page_duration');
      });

      it('returns only pages metrics with table=pages', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.metrics?table=pages')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const metricNames = response.body.map((m: { name: string }) => m.name);
        expect(metricNames).toContain('page_count');
        expect(metricNames).toContain('page_duration');
        expect(metricNames).not.toContain('sessions');
        expect(metricNames).not.toContain('bounce_rate');
      });
    });

    describe('GET /api/analytics.dimensions with table filter', () => {
      it('returns all dimensions without table filter', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.dimensions')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.utm_source).toBeDefined();
        expect(response.body.page_path).toBeDefined();
      });

      it('returns only sessions dimensions with table=sessions', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.dimensions?table=sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.utm_source).toBeDefined();
        expect(response.body.device).toBeDefined();
        expect(response.body.page_path).toBeUndefined();
        expect(response.body.is_landing_page).toBeUndefined();
      });

      it('returns only pages dimensions with table=pages', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.dimensions?table=pages')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.page_path).toBeDefined();
        expect(response.body.is_landing_page).toBeDefined();
        expect(response.body.is_exit_page).toBeDefined();
        expect(response.body.utm_source).toBeUndefined();
        expect(response.body.device).toBeUndefined();
      });
    });

    describe('GET /api/analytics.tables', () => {
      it('returns available tables', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.tables')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body).toContain('sessions');
        expect(response.body).toContain('pages');
        expect(response.body).toContain('goals');
      });
    });
  });

  describe('Goals Table Analytics', () => {
    describe('POST /api/analytics.query with table=goals', () => {
      it('returns goals count from goals table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(Number(response.body.data[0].goals)).toBe(30);
      });

      it('returns goal_value sum from goals table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'goal_value'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data[0]).toHaveProperty('goals');
        expect(response.body.data[0]).toHaveProperty('goal_value');
        // 10 purchase goals with values: 99.99 + [2,5,8,11,14,17,20,23,26,29]
        // = 10 * 99.99 + (2+5+8+11+14+17+20+23+26+29) = 999.9 + 155 = 1154.9
        expect(Number(response.body.data[0].goal_value)).toBeGreaterThan(1000);
      });

      it('returns goals grouped by goal_name', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'goal_value'],
            dimensions: ['goal_name'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(3); // 3 goal types
        expect(response.body.data[0]).toHaveProperty('goal_name');
        expect(response.body.data[0]).toHaveProperty('goals');
        expect(response.body.data[0]).toHaveProperty('goal_value');

        const goalNames = response.body.data.map(
          (d: { goal_name: string }) => d.goal_name,
        );
        expect(goalNames).toContain('add_to_cart');
        expect(goalNames).toContain('checkout_start');
        expect(goalNames).toContain('purchase');
      });

      it('returns goals grouped by channel for attribution', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'goal_value'],
            dimensions: ['channel'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(3); // 3 channels
        expect(response.body.data[0]).toHaveProperty('channel');

        const channels = response.body.data.map(
          (d: { channel: string }) => d.channel,
        );
        expect(channels).toContain('Paid Search');
        expect(channels).toContain('Social');
        expect(channels).toContain('Direct');
      });

      it('returns goals grouped by utm_source for attribution', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['utm_source'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(2); // google and facebook
        const sources = response.body.data.map(
          (d: { utm_source: string }) => d.utm_source,
        );
        expect(sources).toContain('google');
        expect(sources).toContain('facebook');
      });

      it('filters goals by goal_name', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'goal_value'],
            filters: [
              {
                dimension: 'goal_name',
                operator: 'equals',
                values: ['purchase'],
              },
            ],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(Number(response.body.data[0].goals)).toBe(10); // 10 purchase goals
        expect(Number(response.body.data[0].goal_value)).toBeGreaterThan(0);
      });

      it('filters goals by device', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            filters: [
              { dimension: 'device', operator: 'equals', values: ['desktop'] },
            ],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(Number(response.body.data[0].goals)).toBe(15); // Half are desktop
      });

      it('returns avg_goal_value metric', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['avg_goal_value'],
            filters: [
              {
                dimension: 'goal_name',
                operator: 'equals',
                values: ['purchase'],
              },
            ],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data[0]).toHaveProperty('avg_goal_value');
        expect(Number(response.body.data[0].avg_goal_value)).toBeGreaterThan(
          100,
        );
      });

      it('returns unique_sessions_with_goals metric', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['unique_sessions_with_goals'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data[0]).toHaveProperty(
          'unique_sessions_with_goals',
        );
        // 30 goals across 15 sessions (2 goals per session)
        expect(
          Number(response.body.data[0].unique_sessions_with_goals),
        ).toBeLessThanOrEqual(30);
      });

      it('returns time series with granularity for goals', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'goal_value'],
            dateRange: {
              start: '2025-12-01',
              end: '2025-12-10',
              granularity: 'day',
            },
          })
          .expect(200);

        expect(response.body.data.length).toBe(10);
        expect(response.body.data[0]).toHaveProperty('date_day');
      });

      it('validates sessions metric not available on goals table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['sessions'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(400);
      });

      it('validates goals metric not available on sessions table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'sessions',
            metrics: ['goals'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(400);
      });

      it('validates goal_name dimension not available on sessions table', async () => {
        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'sessions',
            metrics: ['sessions'],
            dimensions: ['goal_name'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(400);
      });

      it('returns SQL with FINAL for goals table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.query.sql).toContain('FROM goals FINAL');
      });
    });

    describe('POST /api/analytics.extremes with table=goals', () => {
      it('returns min and max goal_value by goal_name', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.extremes')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metric: 'goal_value',
            groupBy: ['goal_name'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body).toHaveProperty('min');
        expect(response.body).toHaveProperty('max');
        expect(response.body.meta.metric).toBe('goal_value');
        // Only purchase goals have value > 0
        expect(Number(response.body.max)).toBeGreaterThan(0);
      });

      it('returns extremes for goals metric', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.extremes')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metric: 'goals',
            groupBy: ['goal_name'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        // Each goal type has 10 goals
        expect(Number(response.body.min)).toBe(10);
        expect(Number(response.body.max)).toBe(10);
      });
    });

    describe('GET /api/analytics.metrics with table=goals', () => {
      it('returns only goals metrics with table=goals', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.metrics?table=goals')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const metricNames = response.body.map((m: { name: string }) => m.name);
        expect(metricNames).toContain('goals');
        expect(metricNames).toContain('goal_value');
        expect(metricNames).toContain('avg_goal_value');
        expect(metricNames).toContain('unique_sessions_with_goals');
        expect(metricNames).not.toContain('sessions');
        expect(metricNames).not.toContain('page_count');
      });
    });

    describe('GET /api/analytics.dimensions with table=goals', () => {
      it('returns goals dimensions with table=goals', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.dimensions?table=goals')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Goal-specific dimensions
        expect(response.body.goal_name).toBeDefined();
        expect(response.body.goal_path).toBeDefined();

        // Session dimensions available on goals for attribution
        expect(response.body.utm_source).toBeDefined();
        expect(response.body.channel).toBeDefined();
        expect(response.body.device).toBeDefined();
        expect(response.body.country).toBeDefined();

        // Page-only dimensions not available
        expect(response.body.page_path).toBeUndefined();
        expect(response.body.is_landing_page).toBeUndefined();
      });
    });
  });
});
