// Set env vars BEFORE any imports to ensure ConfigModule picks them up
const TEST_SYSTEM_DATABASE = 'staminads_test_system';
process.env.NODE_ENV = 'test';
process.env.CLICKHOUSE_SYSTEM_DATABASE = TEST_SYSTEM_DATABASE;
process.env.JWT_SECRET = 'test-secret-key';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpass';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { generateId, hashPassword } from '../src/common/crypto';
// Workspace ID used in tests - must match what's inserted into workspaces table
const testWorkspaceId = 'analytics_test_ws';
// DB name = staminads_ws_<workspace_id> (matches what ClickHouseService.getWorkspaceDatabaseName returns)
const TEST_WORKSPACE_DATABASE = `staminads_ws_${testWorkspaceId}`;

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

describe('Analytics E2E', () => {
  let app: INestApplication;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let authToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_SYSTEM_DATABASE,
    });

    workspaceClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_WORKSPACE_DATABASE,
    });

    // Create test user for this test suite
    const testEmail = 'analytics-test@test.com';
    const testPassword = 'password123';
    const passwordHash = await hashPassword(testPassword);
    const now = toClickHouseDateTime();

    // Clean users table first to avoid duplicates
    await systemClient.command({ query: 'TRUNCATE TABLE users' });

    await systemClient.insert({
      table: 'users',
      values: [
        {
          id: generateId(),
          email: testEmail,
          password_hash: passwordHash,
          name: 'Analytics Test User',
          type: 'user',
          status: 'active',
          is_super_admin: 1,
          failed_login_attempts: 0,
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    // Force ClickHouse to merge parts and make data visible
    await systemClient.command({ query: 'OPTIMIZE TABLE users FINAL' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Get auth token
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({ email: testEmail, password: testPassword });

    expect(loginRes.status).toBe(201);
    authToken = loginRes.body.access_token;

    // Create test workspace in system database
    workspaceId = testWorkspaceId;
    await systemClient.command({ query: 'TRUNCATE TABLE workspaces' });
    await workspaceClient.command({ query: 'TRUNCATE TABLE sessions' });
    await systemClient.insert({
      table: 'workspaces',
      values: [
        {
          id: workspaceId,
          name: 'Analytics Test Workspace',
          website: 'https://test.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          timescore_reference: 60,
          created_at: toClickHouseDateTime(),
          updated_at: toClickHouseDateTime(),
        },
      ],
      format: 'JSONEachRow',
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

    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    await systemClient.close();
    await workspaceClient.close();
    await app.close();
  });

  describe('POST /api/analytics.query', () => {
    it('returns sessions count with no dimensions', async () => {
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: { preset: 'last_30_days' },
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('respects custom order', async () => {
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      await request(app.getHttpServer())
        .post('/api/analytics.query')
        .send({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dateRange: { start: '2025-12-01', end: '2025-12-28' },
        })
        .expect(401);
    });

    it('returns SQL in response for debugging', async () => {
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
        .post('/api/analytics.extremes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          metric: 'median_duration',
          groupBy: ['channel'],
          dateRange: { preset: 'last_30_days' },
        })
        .expect(200);

      expect(response.body.meta.dateRange.start).toBeDefined();
      expect(response.body.meta.dateRange.end).toBeDefined();
    });

    it('handles multiple groupBy dimensions', async () => {
      const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      await request(app.getHttpServer())
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
      const response1 = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      // Second identical request - should return cached response
      const response2 = await request(app.getHttpServer())
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

      const response1 = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query1)
        .expect(200);

      const response2 = await request(app.getHttpServer())
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

      const response1 = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ...baseQuery, metrics: ['sessions'] })
        .expect(200);

      const response2 = await request(app.getHttpServer())
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

      const response1 = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...baseQuery,
          filters: [
            { dimension: 'device', operator: 'equals', values: ['desktop'] },
          ],
        })
        .expect(200);

      const response2 = await request(app.getHttpServer())
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
        request(app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${authToken}`)
          .send(query),
        request(app.getHttpServer())
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

      const response1 = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      // Same query should return cached result
      const response2 = await request(app.getHttpServer())
        .post('/api/analytics.query')
        .set('Authorization', `Bearer ${authToken}`)
        .send(query)
        .expect(200);

      expect(response1.body.data).toEqual(response2.body.data);
      expect(response1.body.meta.granularity).toBe('day');
    });
  });
});
