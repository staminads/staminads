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
    const pagesBaseDate = new Date();
    pagesBaseDate.setDate(pagesBaseDate.getDate() - 3);
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
        // New aligned columns
        browser_type: 'browser',
        screen_width: 1920,
        screen_height: 1080,
        viewport_width: 1920,
        viewport_height: 900,
        user_agent: 'Mozilla/5.0',
        connection_type: 'wifi',
        referrer_path: '/',
        landing_domain: 'test.com',
        utm_id: '',
        utm_id_from: '',
        timezone: 'America/New_York',
        latitude: null,
        longitude: null,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        day_of_week: date.getDay() || 7,
        week_number: 1,
        hour: date.getHours(),
        is_weekend: date.getDay() === 0 || date.getDay() === 6,
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
          metrics: ['sessions', 'median_duration'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('sessions');
      expect(response.body.data[0]).toHaveProperty('median_duration');
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

    it('returns sessions as integers (not floats) when grouped by dimension', async () => {
      // This test verifies that count() returns integers, not floats
      // If this test fails with float values like 7.5, there's an upstream bug
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration'],
          dimensions: ['device'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Verify we have data
      expect(response.body.data.length).toBeGreaterThan(0);

      // Check each row: sessions must be an integer (no decimal part)
      for (const row of response.body.data) {
        const sessions = Number(row.sessions);
        expect(Number.isInteger(sessions)).toBe(true);
        // Log for debugging if test fails
        if (!Number.isInteger(sessions)) {
          console.log('FAIL: sessions is not an integer:', {
            device: row.device,
            sessions: row.sessions,
            median_duration: row.median_duration,
          });
        }
      }

      // Additional check: sessions should be exactly 15 for each device type
      // (30 total sessions, half desktop, half mobile)
      const desktopRow = response.body.data.find(
        (r: { device: string }) => r.device === 'desktop',
      );
      const mobileRow = response.body.data.find(
        (r: { device: string }) => r.device === 'mobile',
      );
      expect(Number(desktopRow?.sessions)).toBe(15);
      expect(Number(mobileRow?.sessions)).toBe(15);
    });

    it('returns sessions as integers when grouped by landing_path', async () => {
      // Test with landing_path dimension (same as email reports use)
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration'],
          dimensions: ['landing_path'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);

      // Check that all sessions values are integers
      for (const row of response.body.data) {
        const sessions = Number(row.sessions);
        expect(Number.isInteger(sessions)).toBe(true);
      }
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
        response.body.find(
          (m: { name: string }) => m.name === 'median_duration',
        ),
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

  describe('Metric Filters (HAVING clause)', () => {
    it('filters grouped results by bounce_rate > threshold', async () => {
      // First, get all results without metricFilters to understand the data
      const allResponse = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['utm_source'],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // With our test data (duration = 30 + i*5, bounce_threshold = 10s = 10000ms)
      // Sessions with duration < 10000ms are bounces
      // All sessions have duration >= 30ms (way below 10s), so ALL sessions are bounces
      // bounce_rate should be 100% for both utm_sources
      expect(allResponse.body.data.length).toBe(2); // google and facebook

      // Now filter by bounce_rate > 50 (should return all since bounce_rate is 100%)
      const filteredResponse = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Since all bounce_rates are 100%, all rows should pass the filter
      expect(filteredResponse.body.data.length).toBe(2);

      // Verify HAVING clause is in SQL
      expect(filteredResponse.body.query.sql).toContain('HAVING');
    });

    it('filters grouped results by bounce_rate < threshold (excludes high bounce)', async () => {
      // Filter by bounce_rate < 50 (should exclude all since bounce_rate is 100%)
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'lt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // No rows should pass since all have bounce_rate = 100%
      expect(response.body.data.length).toBe(0);
    });

    it('combines metricFilters with dimension filters', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['utm_source'],
          filters: [
            { dimension: 'device', operator: 'equals', values: ['mobile'] },
          ],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Test data: odd sessions have device='mobile' AND utm_source='facebook'
      // So filtering by mobile gives only facebook sessions (15 total)
      // bounce_rate is 100% so it passes the metricFilter
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].utm_source).toBe('facebook');
      expect(Number(response.body.data[0].sessions)).toBe(15);

      // Verify SQL has both WHERE and HAVING
      expect(response.body.query.sql).toContain('device = {f0:String}');
      expect(response.body.query.sql).toContain('HAVING');
    });

    it('combines metricFilters with havingMinSessions', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          havingMinSessions: 10,
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Both utm_sources have 15 sessions each, so both pass havingMinSessions
      // Both have 100% bounce_rate, so both pass metricFilter
      expect(response.body.data.length).toBe(2);

      // Verify HAVING clause has both conditions
      expect(response.body.query.sql).toContain('HAVING');
      expect(response.body.query.sql).toContain('count() >= 10');
    });

    it('filters by median_duration metric', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration'],
          dimensions: ['device'],
          metricFilters: [
            { metric: 'median_duration', operator: 'gte', values: [0.05] }, // 50ms = 0.05s
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Sessions have duration 30 + i*5 ms, so median should be > 50ms for both devices
      expect(response.body.data.length).toBe(2);
    });

    it('returns empty when no rows pass metricFilter', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration'],
          dimensions: ['device'],
          metricFilters: [
            { metric: 'median_duration', operator: 'gt', values: [1000] }, // 1000s - way too high
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // No device should have median_duration > 1000s
      expect(response.body.data.length).toBe(0);
    });

    it('ignores metricFilters when no dimensions and no totalsGroupBy', async () => {
      // Without totalsGroupBy, metricFilters are ignored for totals queries
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: [], // No dimensions = totals
          metricFilters: [
            { metric: 'bounce_rate', operator: 'lt', values: [50] }, // Would exclude if applied
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Since dimensions is empty and no totalsGroupBy, metricFilters are ignored
      expect(response.body.data.length).toBe(1);
      expect(Number(response.body.data[0].sessions)).toBe(30);
      expect(response.body.query.sql).not.toContain('HAVING');
    });

    it('applies metricFilters to totals using totalsGroupBy (filtered totals)', async () => {
      // First, get grouped data with metricFilter to see what passes
      const groupedResponse = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // All utm_sources have 100% bounce_rate, so both should pass
      expect(groupedResponse.body.data.length).toBe(2);
      const totalFromGrouped = groupedResponse.body.data.reduce(
        (sum: number, row: { sessions: string }) => sum + Number(row.sessions),
        0,
      );
      expect(totalFromGrouped).toBe(30); // 15 google + 15 facebook

      // Now get filtered totals using totalsGroupBy
      const totalsResponse = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: [], // Empty = totals
          totalsGroupBy: ['utm_source'], // Group by this for filtering
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Totals should be the sum of filtered groups
      expect(totalsResponse.body.data.length).toBe(1);
      expect(Number(totalsResponse.body.data[0].sessions)).toBe(30);
      expect(Number(totalsResponse.body.data[0].bounce_rate)).toBe(100);

      // SQL should use subquery pattern
      expect(totalsResponse.body.query.sql).toContain('FROM (');
      expect(totalsResponse.body.query.sql).toContain('HAVING');
    });

    it('returns filtered totals that exclude groups not passing metricFilter', async () => {
      // Use a filter that excludes all rows (bounce_rate < 50, but all are 100%)
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: [],
          totalsGroupBy: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'lt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // No groups pass the filter, so totals should be 0
      expect(response.body.data.length).toBe(1);
      expect(Number(response.body.data[0].sessions)).toBe(0);

      // SQL should use subquery pattern with HAVING
      expect(response.body.query.sql).toContain('FROM (');
      expect(response.body.query.sql).toContain('HAVING');
    });

    it('filtered totals respects dimension filters too', async () => {
      // Filter by device=mobile (15 sessions, all facebook) AND bounce_rate > 50
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: [],
          totalsGroupBy: ['utm_source'],
          filters: [
            { dimension: 'device', operator: 'equals', values: ['mobile'] },
          ],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Mobile sessions are all facebook (15), all have 100% bounce_rate
      expect(response.body.data.length).toBe(1);
      expect(Number(response.body.data[0].sessions)).toBe(15);
    });

    it('applies metricFilters to extremes query', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'median_duration',
          groupBy: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(200);

      // Both utm_sources have bounce_rate = 100%, so both pass filter
      expect(response.body).toHaveProperty('min');
      expect(response.body).toHaveProperty('max');
    });

    it('validates unknown metric in metricFilters', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['device'],
          metricFilters: [
            { metric: 'unknown_metric', operator: 'gt', values: [50] },
          ],
          dateRange: { start: '2025-12-01', end: '2025-12-31' },
        })
        .expect(400);
    });

    it('caches queries with different metricFilters separately', async () => {
      const baseQuery = {
        workspace_id: workspaceId,
        metrics: ['sessions', 'bounce_rate'],
        dimensions: ['utm_source'],
        dateRange: { start: '2025-12-01', end: '2025-12-31' },
      };

      // Query with bounce_rate > 50
      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...baseQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        })
        .expect(200);

      // Query with bounce_rate < 50 (different filter)
      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...baseQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'lt', values: [50] },
          ],
        })
        .expect(200);

      // Results should be different (2 rows vs 0 rows)
      expect(response1.body.data.length).toBe(2);
      expect(response2.body.data.length).toBe(0);
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
        .send({ ...baseQuery, metrics: ['median_duration'] })
        .expect(200);

      // Different metrics means different queries
      expect(response1.body.meta.metrics).toEqual(['sessions']);
      expect(response2.body.meta.metrics).toEqual(['median_duration']);
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
        metrics: ['sessions', 'median_duration'],
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
        expect(metricNames).toContain('median_duration');
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

      it('returns sum_goal_value from goals table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'sum_goal_value'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data[0]).toHaveProperty('goals');
        expect(response.body.data[0]).toHaveProperty('sum_goal_value');
        // 10 purchase goals with values: 99.99 + [2,5,8,11,14,17,20,23,26,29]
        // = 10 * 99.99 + (2+5+8+11+14+17+20+23+26+29) = 999.9 + 155 = 1154.9
        expect(Number(response.body.data[0].sum_goal_value)).toBeGreaterThan(
          1000,
        );
      });

      it('returns goals grouped by goal_name', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals', 'sum_goal_value'],
            dimensions: ['goal_name'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(3); // 3 goal types
        expect(response.body.data[0]).toHaveProperty('goal_name');
        expect(response.body.data[0]).toHaveProperty('goals');
        expect(response.body.data[0]).toHaveProperty('sum_goal_value');

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
            metrics: ['goals', 'sum_goal_value'],
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
            metrics: ['goals', 'sum_goal_value'],
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
        expect(Number(response.body.data[0].sum_goal_value)).toBeGreaterThan(0);
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
            metrics: ['goals', 'sum_goal_value'],
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
      it('returns min and max sum_goal_value by goal_name', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.extremes')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metric: 'sum_goal_value',
            groupBy: ['goal_name'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body).toHaveProperty('min');
        expect(response.body).toHaveProperty('max');
        expect(response.body.meta.metric).toBe('sum_goal_value');
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
        expect(metricNames).toContain('sum_goal_value');
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

      it('returns new aligned dimensions for goals table', async () => {
        const response = await request(ctx.app.getHttpServer())
          .get('/api/analytics.dimensions?table=goals')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        // Time dimensions (now available on goals)
        expect(response.body.year).toBeDefined();
        expect(response.body.month).toBeDefined();
        expect(response.body.day).toBeDefined();
        expect(response.body.hour).toBeDefined();
        expect(response.body.day_of_week).toBeDefined();
        expect(response.body.week_number).toBeDefined();
        expect(response.body.is_weekend).toBeDefined();

        // Device dimensions (now available on goals)
        expect(response.body.browser_type).toBeDefined();
        expect(response.body.screen_width).toBeDefined();
        expect(response.body.screen_height).toBeDefined();
        expect(response.body.viewport_width).toBeDefined();
        expect(response.body.viewport_height).toBeDefined();
        expect(response.body.connection_type).toBeDefined();

        // Traffic/geo dimensions (now available on goals)
        expect(response.body.referrer_path).toBeDefined();
        expect(response.body.landing_domain).toBeDefined();
        expect(response.body.timezone).toBeDefined();
      });
    });

    describe('Goals grouped by new dimensions', () => {
      it('groups goals by hour with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['hour'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBeGreaterThan(0);
        // Verify hour is a valid number between 0-23
        const hours = response.body.data.map((d: { hour: number }) => d.hour);
        hours.forEach((h: number) => {
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(23);
        });
        // All 30 goals should be accounted for
        const totalGoals = response.body.data.reduce(
          (sum: number, d: { goals: string }) => sum + Number(d.goals),
          0,
        );
        expect(totalGoals).toBe(30);
      });

      it('groups goals by browser_type with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['browser_type'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].browser_type).toBe('browser');
        expect(Number(response.body.data[0].goals)).toBe(30);
      });

      it('groups goals by timezone with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['timezone'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].timezone).toBe('America/New_York');
        expect(Number(response.body.data[0].goals)).toBe(30);
      });

      it('groups goals by screen_width with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['screen_width'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(1);
        expect(Number(response.body.data[0].screen_width)).toBe(1920);
        expect(Number(response.body.data[0].goals)).toBe(30);
      });

      it('groups goals by landing_domain with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['landing_domain'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].landing_domain).toBe('test.com');
        expect(Number(response.body.data[0].goals)).toBe(30);
      });

      it('groups goals by connection_type with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['connection_type'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].connection_type).toBe('wifi');
        expect(Number(response.body.data[0].goals)).toBe(30);
      });

      it('filters goals by is_weekend with correct counts', async () => {
        // baseDate is 2025-12-01 which is a Monday, goals span multiple days
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['is_weekend'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        // Should have both weekend and weekday goals
        expect(response.body.data.length).toBeGreaterThanOrEqual(1);
        const totalGoals = response.body.data.reduce(
          (sum: number, d: { goals: string }) => sum + Number(d.goals),
          0,
        );
        expect(totalGoals).toBe(30);
      });

      it('groups goals by year/month/day with correct values', async () => {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            workspace_id: workspaceId,
            table: 'goals',
            metrics: ['goals'],
            dimensions: ['year', 'month', 'day'],
            dateRange: { start: '2025-12-01', end: '2025-12-31' },
          })
          .expect(200);

        expect(response.body.data.length).toBeGreaterThan(0);
        // First goal is on 2025-12-01
        const dec1 = response.body.data.find(
          (d: { year: number; month: number; day: number }) =>
            d.year === 2025 && d.month === 12 && d.day === 1,
        );
        expect(dec1).toBeDefined();
        expect(Number(dec1.goals)).toBeGreaterThan(0);
      });
    });
  });
});
