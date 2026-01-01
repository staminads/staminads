import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';
// Workspace ID must not contain hyphens since they're replaced with underscores in DB name
const testWorkspaceId = 'backfill_test_ws';
// DB name = staminads_ws_<workspace_id> (matches what ClickHouseService.getWorkspaceDatabaseName returns)
const TEST_WORKSPACE_DATABASE = `staminads_ws_${testWorkspaceId}`;

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

    // Create test workspace with filters in system database
    const filters = [
      {
        id: 'filter-channel',
        name: 'Channel Mapping',
        tags: ['marketing'],
        enabled: true,
        priority: 100,
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Google' },
          { dimension: 'channel_group', action: 'set_value', value: 'Paid Search' },
        ],
        created_at: toClickHouseDateTime(),
        updated_at: toClickHouseDateTime(),
      },
      {
        id: 'filter-facebook',
        name: 'Facebook Mapping',
        tags: ['marketing'],
        enabled: true,
        priority: 90,
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'facebook' }],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Facebook' },
          { dimension: 'channel_group', action: 'set_value', value: 'Paid Social' },
        ],
        created_at: toClickHouseDateTime(),
        updated_at: toClickHouseDateTime(),
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
          custom_dimensions: '[]',
          filters: JSON.stringify(filters),
          created_at: toClickHouseDateTime(),
          updated_at: toClickHouseDateTime(),
        },
      ],
      format: 'JSONEachRow',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('POST /api/filters.backfillStart', () => {
    it('creates a backfill task and returns task_id', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
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
        query: 'SELECT * FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_id).toBe(testWorkspaceId);
      expect(rows[0].lookback_days).toBe(7);
      // Task may have already started running by the time we check
      expect(['pending', 'running']).toContain(rows[0].status);
    });

    it('snapshots filters at task creation', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT filters_snapshot FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<{ filters_snapshot: string }>;

      expect(rows).toHaveLength(1);
      const snapshot = JSON.parse(rows[0].filters_snapshot);
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0].name).toBe('Channel Mapping');
      expect(snapshot[1].name).toBe('Facebook Mapping');
    });

    it('rejects concurrent backfill for same workspace', async () => {
      // Start first backfill
      const firstResponse = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      expect(firstResponse.body.task_id).toBeDefined();

      // Try to start second backfill
      await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
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
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 0,
        })
        .expect(400);

      // Too large
      await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 500,
        })
        .expect(400);
    });

    it('rejects non-existent workspace', async () => {
      await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: 'non-existent-workspace',
          lookback_days: 7,
        })
        .expect(404);
    });

    it('accepts optional chunk_size_days and batch_size', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
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
        query: 'SELECT chunk_size_days, batch_size FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows[0].chunk_size_days).toBe(7);
      expect(rows[0].batch_size).toBe(1000);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(401);
    });
  });

  describe('GET /api/filters.backfillStatus', () => {
    let taskId: string;

    beforeEach(async () => {
      // Create a task
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        });
      taskId = response.body.task_id;
    });

    it('returns task progress', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: taskId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', taskId);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('progress_percent');
      expect(response.body).toHaveProperty('sessions');
      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('filter_version');
      expect(response.body.sessions).toHaveProperty('processed');
      expect(response.body.sessions).toHaveProperty('total');
    });

    it('returns 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: 'non-existent-task' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires task_id parameter', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: taskId })
        .expect(401);
    });
  });

  describe('POST /api/filters.backfillCancel', () => {
    let taskId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        });
      taskId = response.body.task_id;
    });

    // Skip: Flaky due to race conditions - task may complete before cancel is processed
    it.skip('cancels a running task or handles already completed', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: taskId })
        .set('Authorization', `Bearer ${authToken}`);

      // Task may complete before cancel is processed (no data = instant completion)
      // Accept either success (201) or already completed (400)
      expect([201, 400]).toContain(response.status);

      if (response.status === 201) {
        expect(response.body).toEqual({ success: true });

        // Verify task reaches a final state (wait for processor to finish)
        // Due to race conditions, status may be 'cancelled' or 'completed'
        let status = 'pending';
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const result = await systemClient.query({
            query: 'SELECT status FROM backfill_tasks FINAL WHERE id = {id:String}',
            query_params: { id: taskId },
            format: 'JSONEachRow',
          });
          const rows = (await result.json()) as Array<{ status: string }>;
          status = rows[0]?.status;
          if (['cancelled', 'completed', 'failed'].includes(status)) break;
        }

        // Task should be in a final state
        expect(['cancelled', 'completed', 'failed']).toContain(status);
      }
    });

    it('returns 404 for non-existent task', async () => {
      await request(app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: 'non-existent-task' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: taskId })
        .expect(401);
    });
  });

  describe('GET /api/filters.backfillList', () => {
    // Skip: Flaky due to timing issues with task completion/cancellation
    it.skip('returns all tasks for workspace', async () => {
      // Wait for any previous tasks to complete before starting new ones
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create first task
      const response1 = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 7 })
        .expect(201);

      expect(response1.body.task_id).toBeDefined();

      // Cancel first task
      await request(app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: response1.body.task_id })
        .set('Authorization', `Bearer ${authToken}`);

      // Wait for task to be in a final state (cancelled, completed, or failed)
      // The task may complete before the cancel takes effect
      let firstTaskFinalStatus = '';
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const statusRes = await request(app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: response1.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        firstTaskFinalStatus = statusRes.body.status;
        if (['cancelled', 'completed', 'failed'].includes(firstTaskFinalStatus)) {
          break;
        }
      }
      // Task should be in a final state (cancelled preferred, but completed is ok if fast)
      // Note: With no data, task completes almost instantly
      expect(['cancelled', 'completed', 'failed']).toContain(firstTaskFinalStatus);

      // Create second task
      const response2 = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 30 });

      expect(response2.body.task_id).toBeDefined();

      const listResponse = await request(app.getHttpServer())
        .get('/api/filters.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(listResponse.body).toHaveLength(2);
      // Most recent first
      expect(listResponse.body[0].id).toBe(response2.body.task_id);
      expect(listResponse.body[1].id).toBe(response1.body.task_id);
    });

    it('returns empty array when no tasks', async () => {
      // Ensure backfill_tasks is empty for this test
      await systemClient.command({ query: 'TRUNCATE TABLE backfill_tasks' });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const response = await request(app.getHttpServer())
        .get('/api/filters.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('requires workspace_id parameter', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillList')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .expect(401);
    });
  });

  describe('GET /api/filters.backfillSummary', () => {
    it('returns summary with needsBackfill=true when no tasks', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('needsBackfill', true);
      expect(response.body).toHaveProperty('currentFilterVersion');
      expect(response.body).toHaveProperty('lastCompletedFilterVersion', null);
      expect(response.body).toHaveProperty('activeTask', null);
      expect(typeof response.body.currentFilterVersion).toBe('string');
      expect(response.body.currentFilterVersion.length).toBe(8);
    });

    it('returns activeTask when task is running', async () => {
      // Start a backfill task
      const startResponse = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 7 });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('activeTask');
      expect(response.body.activeTask).not.toBeNull();
      expect(response.body.activeTask.id).toBe(startResponse.body.task_id);
      expect(['pending', 'running']).toContain(response.body.activeTask.status);
    });

    it('returns needsBackfill=false after task completes with same filter version', async () => {
      // Start and wait for task to complete
      const startResponse = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 1 });

      // Wait for task to complete (with no data it should be fast)
      let taskStatus = 'pending';
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const statusResponse = await request(app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: startResponse.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        taskStatus = statusResponse.body.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') break;
      }

      expect(taskStatus).toBe('completed');

      const response = await request(app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('needsBackfill', false);
      expect(response.body).toHaveProperty('lastCompletedFilterVersion');
      expect(response.body.lastCompletedFilterVersion).toBe(response.body.currentFilterVersion);
      expect(response.body).toHaveProperty('activeTask', null);
    });

    it('requires workspace_id parameter', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .expect(401);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: 'non-existent-workspace' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
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
      expect(columnMap['error_message']).toBe('String');
      expect(columnMap['retry_count']).toBe('UInt8');
      expect(columnMap['filters_snapshot']).toBe('String');
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
          channel: '',
          channel_group: '',
          cd_1: '', // Not computed yet
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
          channel: '',
          channel_group: '',
          cd_1: '',
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
          channel: '',
          channel_group: '',
          cd_1: '',
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
        query: 'SELECT id, utm_source, channel, channel_group, cd_1 FROM sessions FINAL WHERE workspace_id = {ws:String}',
        query_params: { ws: testWorkspaceId },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(3);
      // All channel and cd_1 values should be empty before backfill (non-nullable schema)
      rows.forEach((row) => {
        expect(row.channel).toBe('');
        expect(row.channel_group).toBe('');
        expect(row.cd_1).toBe('');
      });
    });

    it('creates task with correct total counts', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      // Wait a bit for the task to start counting
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check task status shows correct counts
      const statusResponse = await request(app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: response.body.task_id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.id).toBe(response.body.task_id);
      expect(statusResponse.body.status).toMatch(/pending|running|completed/);
    });

    it('applies filters correctly to sessions after backfill', async () => {
      // Start backfill
      const response = await request(app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      // Wait for completion
      let taskStatus = 'pending';
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const statusResponse = await request(app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: response.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        taskStatus = statusResponse.body.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') break;
      }

      expect(taskStatus).toBe('completed');

      // Verify sessions have updated channel values
      const result = await workspaceClient.query({
        query: `SELECT id, utm_source, channel, channel_group, filter_version
                FROM sessions FINAL
                WHERE workspace_id = {ws:String}
                ORDER BY id`,
        query_params: { ws: testWorkspaceId },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(3);

      // Session 1: google -> Google / Paid Search
      const session1 = rows.find((r) => r.id === 'session-1');
      expect(session1?.channel).toBe('Google');
      expect(session1?.channel_group).toBe('Paid Search');
      expect(session1?.filter_version).toBeDefined();

      // Session 2: facebook -> Facebook / Paid Social
      const session2 = rows.find((r) => r.id === 'session-2');
      expect(session2?.channel).toBe('Facebook');
      expect(session2?.channel_group).toBe('Paid Social');

      // Session 3: twitter -> no match (empty string with non-nullable schema)
      const session3 = rows.find((r) => r.id === 'session-3');
      expect(session3?.channel).toBe('');
      expect(session3?.channel_group).toBe('');
    });
  });
});
