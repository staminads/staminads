import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';
const TEST_WORKSPACE_DATABASE = 'staminads_test_ws';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function toClickHouseDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

describe('Backfill Integration', () => {
  let app: INestApplication;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let authToken: string;

  const testWorkspaceId = 'backfill-test-ws';

  beforeAll(async () => {
    // Override env vars for test databases
    process.env.CLICKHOUSE_SYSTEM_DATABASE = TEST_SYSTEM_DATABASE;
    process.env.JWT_SECRET = 'test-secret-key';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'testpass';

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

    // Direct ClickHouse clients for verification
    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_SYSTEM_DATABASE,
    });

    workspaceClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_WORKSPACE_DATABASE,
    });

    // Get auth token
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      });

    expect(loginRes.status).toBe(201);
    expect(loginRes.body.access_token).toBeDefined();
    authToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    await systemClient.close();
    await workspaceClient.close();
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await systemClient.command({ query: 'TRUNCATE TABLE workspaces' });
    await workspaceClient.command({ query: 'TRUNCATE TABLE sessions' });
    await workspaceClient.command({ query: 'TRUNCATE TABLE events' });
    await systemClient.command({ query: 'TRUNCATE TABLE backfill_tasks' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create test workspace with custom dimensions in system database
    const customDimensions = [
      {
        id: 'cd-channel',
        slot: 1,
        name: 'Channel',
        category: 'Marketing',
        rules: [
          {
            conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
            outputValue: 'Google',
          },
          {
            conditions: [{ field: 'utm_source', operator: 'equals', value: 'facebook' }],
            outputValue: 'Facebook',
          },
        ],
        defaultValue: 'Other',
        version: 'v1',
        createdAt: toClickHouseDateTime(),
        updatedAt: toClickHouseDateTime(),
      },
    ];

    await systemClient.insert({
      table: 'workspaces',
      values: [
        {
          id: testWorkspaceId,
          name: 'Backfill Test Workspace',
          website: 'https://backfill-test.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          timescore_reference: 60,
          custom_dimensions: JSON.stringify(customDimensions),
          created_at: toClickHouseDateTime(),
          updated_at: toClickHouseDateTime(),
        },
      ],
      format: 'JSONEachRow',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('POST /api/customDimensions.backfillStart', () => {
    it('creates a backfill task and returns task_id', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      expect(response.body).toHaveProperty('task_id');
      expect(typeof response.body.task_id).toBe('string');
      expect(response.body.task_id.length).toBeGreaterThan(0);

      // Verify task was created in ClickHouse system database
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT * FROM backfill_tasks WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_id).toBe(testWorkspaceId);
      expect(rows[0].lookback_days).toBe(7);
      expect(rows[0].status).toBe('pending');
    });

    it('snapshots custom dimensions at task creation', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT dimensions_snapshot FROM backfill_tasks WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<{ dimensions_snapshot: string }>;

      expect(rows).toHaveLength(1);
      const snapshot = JSON.parse(rows[0].dimensions_snapshot);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].name).toBe('Channel');
      expect(snapshot[0].slot).toBe(1);
    });

    it('rejects concurrent backfill for same workspace', async () => {
      // Start first backfill
      const firstResponse = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      expect(firstResponse.body.task_id).toBeDefined();

      // Try to start second backfill
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(409); // Conflict
    });

    it('validates lookback_days range', async () => {
      // Too small
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 0,
        })
        .expect(400);

      // Too large
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 500,
        })
        .expect(400);
    });

    it('rejects non-existent workspace', async () => {
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: 'non-existent-workspace',
          lookback_days: 7,
        })
        .expect(404);
    });

    it('accepts optional chunk_size_days and batch_size', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 30,
          chunk_size_days: 7,
          batch_size: 1000,
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT chunk_size_days, batch_size FROM backfill_tasks WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows[0].chunk_size_days).toBe(7);
      expect(rows[0].batch_size).toBe(1000);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(401);
    });
  });

  describe('GET /api/customDimensions.backfillStatus', () => {
    let taskId: string;

    beforeEach(async () => {
      // Create a task
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        });
      taskId = response.body.task_id;
    });

    it('returns task progress', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .query({ task_id: taskId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', taskId);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('progress_percent');
      expect(response.body).toHaveProperty('sessions');
      expect(response.body).toHaveProperty('events');
      expect(response.body.sessions).toHaveProperty('processed');
      expect(response.body.sessions).toHaveProperty('total');
    });

    it('returns 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .query({ task_id: 'non-existent-task' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires task_id parameter', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .query({ task_id: taskId })
        .expect(401);
    });
  });

  describe('POST /api/customDimensions.backfillCancel', () => {
    let taskId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        });
      taskId = response.body.task_id;
    });

    it('cancels a running task', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillCancel')
        .query({ task_id: taskId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(response.body).toEqual({ success: true });

      // Verify task status is cancelled (wait for mutation to complete)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await systemClient.query({
        query: 'SELECT status FROM backfill_tasks WHERE id = {id:String} ORDER BY created_at DESC LIMIT 1',
        query_params: { id: taskId },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<{ status: string }>;

      expect(rows[0].status).toBe('cancelled');
    });

    it('returns 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillCancel')
        .query({ task_id: 'non-existent-task' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillCancel')
        .query({ task_id: taskId })
        .expect(401);
    });
  });

  describe('GET /api/customDimensions.backfillList', () => {
    it('returns all tasks for workspace', async () => {
      // Create multiple tasks (cancel first to allow second)
      const response1 = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 7 });

      await request(app.getHttpServer())
        .post('/api/customDimensions.backfillCancel')
        .query({ task_id: response1.body.task_id })
        .set('Authorization', `Bearer ${authToken}`);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const response2 = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 30 });

      const listResponse = await request(app.getHttpServer())
        .get('/api/customDimensions.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(listResponse.body).toHaveLength(2);
      // Most recent first
      expect(listResponse.body[0].id).toBe(response2.body.task_id);
      expect(listResponse.body[1].id).toBe(response1.body.task_id);
    });

    it('returns empty array when no tasks', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/customDimensions.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('requires workspace_id parameter', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillList')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/customDimensions.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .expect(401);
    });
  });

  describe('Table Schema Verification', () => {
    it('backfill_tasks table has all required columns', async () => {
      const result = await systemClient.query({
        query: 'DESCRIBE TABLE backfill_tasks',
        format: 'JSONEachRow',
      });
      const columns = (await result.json()) as Array<{ name: string; type: string }>;
      const columnMap = Object.fromEntries(columns.map((c) => [c.name, c.type]));

      expect(columnMap['id']).toBe('String');
      expect(columnMap['workspace_id']).toBe('String');
      expect(columnMap['status']).toMatch(/Enum8/);
      expect(columnMap['lookback_days']).toBe('UInt16');
      expect(columnMap['chunk_size_days']).toBe('UInt8');
      expect(columnMap['batch_size']).toBe('UInt32');
      expect(columnMap['total_sessions']).toBe('UInt64');
      expect(columnMap['processed_sessions']).toBe('UInt64');
      expect(columnMap['total_events']).toBe('UInt64');
      expect(columnMap['processed_events']).toBe('UInt64');
      expect(columnMap['current_date_chunk']).toMatch(/Nullable\(Date\)/);
      expect(columnMap['created_at']).toMatch(/DateTime64/);
      expect(columnMap['started_at']).toMatch(/Nullable\(DateTime64/);
      expect(columnMap['completed_at']).toMatch(/Nullable\(DateTime64/);
      expect(columnMap['error_message']).toMatch(/Nullable\(String\)/);
      expect(columnMap['retry_count']).toBe('UInt8');
      expect(columnMap['dimensions_snapshot']).toBe('String');
    });
  });

  describe('Full Backfill Flow', () => {
    beforeEach(async () => {
      // Insert test sessions with different UTM sources in workspace database
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const sessions = [
        {
          id: 'session-1',
          workspace_id: testWorkspaceId,
          created_at: toClickHouseDateTime(yesterday),
          updated_at: toClickHouseDateTime(yesterday),
          utm_source: 'google',
          utm_medium: 'cpc',
          landing_page: 'https://test.com',
          is_direct: false,
          year: yesterday.getFullYear(),
          month: yesterday.getMonth() + 1,
          day: yesterday.getDate(),
          day_of_week: yesterday.getDay(),
          week_number: 1,
          hour: yesterday.getHours(),
          is_weekend: false,
          cd_1: null, // Not computed yet
        },
        {
          id: 'session-2',
          workspace_id: testWorkspaceId,
          created_at: toClickHouseDateTime(yesterday),
          updated_at: toClickHouseDateTime(yesterday),
          utm_source: 'facebook',
          utm_medium: 'social',
          landing_page: 'https://test.com',
          is_direct: false,
          year: yesterday.getFullYear(),
          month: yesterday.getMonth() + 1,
          day: yesterday.getDate(),
          day_of_week: yesterday.getDay(),
          week_number: 1,
          hour: yesterday.getHours(),
          is_weekend: false,
          cd_1: null,
        },
        {
          id: 'session-3',
          workspace_id: testWorkspaceId,
          created_at: toClickHouseDateTime(yesterday),
          updated_at: toClickHouseDateTime(yesterday),
          utm_source: 'twitter',
          utm_medium: 'social',
          landing_page: 'https://test.com',
          is_direct: false,
          year: yesterday.getFullYear(),
          month: yesterday.getMonth() + 1,
          day: yesterday.getDate(),
          day_of_week: yesterday.getDay(),
          week_number: 1,
          hour: yesterday.getHours(),
          is_weekend: false,
          cd_1: null,
        },
      ];

      await workspaceClient.insert({
        table: 'sessions',
        values: sessions,
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('verifies sessions exist before backfill', async () => {
      const result = await workspaceClient.query({
        query: 'SELECT id, utm_source, cd_1 FROM sessions FINAL WHERE workspace_id = {ws:String}',
        query_params: { ws: testWorkspaceId },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(3);
      // All cd_1 values should be null before backfill
      rows.forEach((row) => {
        expect(row.cd_1).toBeNull();
      });
    });

    it('creates task with correct total counts', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/customDimensions.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      // Check task status shows correct counts
      const statusResponse = await request(app.getHttpServer())
        .get('/api/customDimensions.backfillStatus')
        .query({ task_id: response.body.task_id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.id).toBe(response.body.task_id);
      expect(statusResponse.body.status).toMatch(/pending|running/);
    });
  });
});
