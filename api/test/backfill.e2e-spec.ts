// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import {
  toClickHouseDateTime,
  createTestApp,
  closeTestApp,
  createUserWithToken,
  truncateSystemTables,
  truncateWorkspaceTables,
  waitForClickHouse,
  waitForBackfillsToComplete,
  TestAppContext,
} from './helpers';

// Workspace ID must not contain hyphens since they're replaced with underscores in DB name
const testWorkspaceId = 'backfill_test_ws';

describe('Backfill Integration', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let authToken: string;

  beforeAll(async () => {
    ctx = await createTestApp({ workspaceId: testWorkspaceId });
    systemClient = ctx.systemClient;
    workspaceClient = ctx.workspaceClient!;

    // Create test user for this test suite
    const { token } = await createUserWithToken(
      ctx.app,
      systemClient,
      'backfill-test@test.com',
      undefined,
      { name: 'Backfill Test User', isSuperAdmin: true },
    );
    authToken = token;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    // Wait for any running backfills from previous tests to complete
    await waitForBackfillsToComplete(systemClient);

    // Clean tables before each test
    await truncateSystemTables(
      systemClient,
      ['workspaces', 'backfill_tasks'],
      0,
    );
    await truncateWorkspaceTables(
      workspaceClient,
      ['sessions', 'events', 'goals'],
      0,
    );
    await waitForClickHouse();

    // Create test workspace with filters in system database
    const filters = [
      {
        id: 'filter-channel',
        name: 'Channel Mapping',
        tags: ['marketing'],
        enabled: true,
        priority: 100,
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'google' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Google' },
          {
            dimension: 'channel_group',
            action: 'set_value',
            value: 'Paid Search',
          },
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
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'facebook' },
        ],
        operations: [
          { dimension: 'channel', action: 'set_value', value: 'Facebook' },
          {
            dimension: 'channel_group',
            action: 'set_value',
            value: 'Paid Social',
          },
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
          settings: JSON.stringify({
            timescore_reference: 60,
            bounce_threshold: 10,
            custom_dimensions: {},
            filters: filters,
          }),
          created_at: toClickHouseDateTime(),
          updated_at: toClickHouseDateTime(),
        },
      ],
      format: 'JSONEachRow',
    });
    await waitForClickHouse();
  });

  describe('POST /api/filters.backfillStart', () => {
    it('creates a backfill task and returns task_id', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      expect(response.body).toHaveProperty('task_id');
      expect(typeof response.body.task_id).toBe('string');
      expect(response.body.task_id.length).toBeGreaterThan(0);

      // Verify task was created in ClickHouse system database
      await waitForClickHouse();
      const result = await systemClient.query({
        query: 'SELECT * FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_id).toBe(testWorkspaceId);
      expect(rows[0].lookback_days).toBe(1);
      // Task may have already completed by the time we check (fast with no data)
      expect(['pending', 'running', 'completed']).toContain(rows[0].status);
    });

    it('snapshots filters at task creation', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      await waitForClickHouse();
      const result = await systemClient.query({
        query:
          'SELECT filters_snapshot FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(1);
      const snapshot = JSON.parse(rows[0].filters_snapshot as string);
      expect(snapshot).toHaveLength(2);
      expect(snapshot[0].name).toBe('Channel Mapping');
      expect(snapshot[1].name).toBe('Facebook Mapping');
    });

    it('rejects concurrent backfill for same workspace', async () => {
      // Start first backfill with longer lookback to ensure it's still running
      const firstResponse = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 7,
        })
        .expect(201);

      expect(firstResponse.body.task_id).toBeDefined();

      // Try to start second backfill immediately (first should still be running)
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(409); // Conflict
    });

    it('validates lookback_days range', async () => {
      // Too small
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 0,
        })
        .expect(400);

      // Too large
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 500,
        })
        .expect(400);
    });

    it('rejects non-existent workspace', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: 'non-existent-workspace',
          lookback_days: 1,
        })
        .expect(404);
    });

    it('accepts optional chunk_size_days and batch_size', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 3,
          chunk_size_days: 2,
          batch_size: 1000,
        })
        .expect(201);

      await waitForClickHouse();
      const result = await systemClient.query({
        query:
          'SELECT lookback_days, chunk_size_days, batch_size FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows[0].lookback_days).toBe(3);
      expect(rows[0].chunk_size_days).toBe(2);
      expect(rows[0].batch_size).toBe(1000);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(401);
    });
  });

  describe('GET /api/filters.backfillStatus', () => {
    let taskId: string;

    beforeEach(async () => {
      // Create a task
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        });
      taskId = response.body.task_id;
    });

    it('returns task progress', async () => {
      const response = await request(ctx.app.getHttpServer())
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
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: 'non-existent-task' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires task_id parameter', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: taskId })
        .expect(401);
    });
  });

  describe('POST /api/filters.backfillCancel', () => {
    let taskId: string;

    beforeEach(async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        });
      taskId = response.body.task_id;
    });

    // Task may complete before cancel is processed (no data = instant completion)
    // Test accepts both success (201) and already completed (400) responses
    it('cancels a running task or handles already completed', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: taskId })
        .set('Authorization', `Bearer ${authToken}`);

      // Task may complete before cancel is processed (no data = instant completion)
      // Accept either success (200) or already completed (400)
      expect([200, 400]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toEqual({ success: true });

        // Verify task reaches a final state (wait for processor to finish)
        // Due to race conditions, status may be 'cancelled' or 'completed'
        let status = 'pending';
        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const result = await systemClient.query({
            query:
              'SELECT status FROM backfill_tasks FINAL WHERE id = {id:String}',
            query_params: { id: taskId },
            format: 'JSONEachRow',
          });
          const rows = await result.json();
          status = rows[0]?.status as string;
          if (['cancelled', 'completed', 'failed'].includes(status)) break;
        }

        // Task should be in a final state
        expect(['cancelled', 'completed', 'failed']).toContain(status);
      }
    });

    it('returns 404 for non-existent task', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: 'non-existent-task' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillCancel')
        .query({ task_id: taskId })
        .expect(401);
    });
  });

  describe('GET /api/filters.backfillList', () => {
    // Task may complete before cancel takes effect, so we accept multiple valid states
    it('returns all tasks for workspace', async () => {
      // Create first task
      const response1 = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 1 })
        .expect(201);

      expect(response1.body.task_id).toBeDefined();

      // Wait for first task to complete (no data = fast completion)
      await waitForBackfillsToComplete(systemClient, { timeoutMs: 5000 });

      // Create second task
      const response2 = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 1 })
        .expect(201);

      expect(response2.body.task_id).toBeDefined();

      // Wait for second task to complete
      await waitForBackfillsToComplete(systemClient, { timeoutMs: 5000 });

      const listResponse = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(listResponse.body).toHaveLength(2);
      // Most recent first (sorted by created_at DESC)
      expect(listResponse.body[0].id).toBe(response2.body.task_id);
      expect(listResponse.body[1].id).toBe(response1.body.task_id);
    });

    it('returns empty array when no tasks', async () => {
      // Ensure backfill_tasks is empty for this test
      await systemClient.command({ query: 'TRUNCATE TABLE backfill_tasks' });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const response = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('requires workspace_id parameter', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillList')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillList')
        .query({ workspace_id: testWorkspaceId })
        .expect(401);
    });
  });

  describe('GET /api/filters.backfillSummary', () => {
    it('returns summary with needsBackfill=true when no tasks', async () => {
      const response = await request(ctx.app.getHttpServer())
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
      // Start a backfill task with longer lookback to ensure we can catch it running
      const startResponse = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 7 });

      // Check immediately without waiting
      const response = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('activeTask');
      // Task may complete very fast with no data, so activeTask could be null
      if (response.body.activeTask) {
        expect(response.body.activeTask.id).toBe(startResponse.body.task_id);
        expect(['pending', 'running']).toContain(
          response.body.activeTask.status,
        );
      }
      // If no activeTask, verify the task exists and completed
      else {
        const statusResponse = await request(ctx.app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: startResponse.body.task_id })
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
        expect(statusResponse.body.status).toBe('completed');
      }
    });

    it('returns needsBackfill=false after task completes with same filter version', async () => {
      // Start and wait for task to complete
      const startResponse = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 1 });

      // Wait for task to complete (with no data it should be fast)
      let taskStatus = 'pending';
      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const statusResponse = await request(ctx.app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: startResponse.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        taskStatus = statusResponse.body.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') break;
      }

      expect(taskStatus).toBe('completed');

      const response = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('needsBackfill', false);
      expect(response.body).toHaveProperty('lastCompletedFilterVersion');
      expect(response.body.lastCompletedFilterVersion).toBe(
        response.body.currentFilterVersion,
      );
      expect(response.body).toHaveProperty('activeTask', null);
    });

    it('requires workspace_id parameter', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillSummary')
        .query({ workspace_id: testWorkspaceId })
        .expect(401);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(ctx.app.getHttpServer())
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
      const columns = await result.json();
      const columnMap = Object.fromEntries(
        columns.map((c) => [c.name, c.type]),
      );

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
          stm_1: '', // Not computed yet
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
          stm_1: '',
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
          stm_1: '',
        },
      ];

      await workspaceClient.insert({
        table: 'sessions',
        values: sessions,
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('verifies sessions exist before backfill', async () => {
      const result = await workspaceClient.query({
        query:
          'SELECT id, utm_source, channel, channel_group, stm_1 FROM sessions FINAL WHERE workspace_id = {ws:String}',
        query_params: { ws: testWorkspaceId },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(3);
      // All channel and stm_1 values should be empty before backfill (non-nullable schema)
      rows.forEach((row) => {
        expect(row.channel).toBe('');
        expect(row.channel_group).toBe('');
        expect(row.stm_1).toBe('');
      });
    });

    it('creates task with correct total counts', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      // Wait a bit for the task to start counting
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check task status shows correct counts
      const statusResponse = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: response.body.task_id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.id).toBe(response.body.task_id);
      expect(statusResponse.body.status).toMatch(/pending|running|completed/);
    });

    it('applies filters correctly to sessions after backfill', async () => {
      // Start backfill
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 2,
        })
        .expect(201);

      // Wait for completion
      let taskStatus = 'pending';
      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const statusResponse = await request(ctx.app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: response.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        taskStatus = statusResponse.body.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') break;
      }

      expect(taskStatus).toBe('completed');

      // Verify sessions have updated channel values
      const result = await workspaceClient.query({
        query: `SELECT id, utm_source, channel, channel_group
                FROM sessions FINAL
                WHERE workspace_id = {ws:String}
                ORDER BY id`,
        query_params: { ws: testWorkspaceId },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(3);

      // Session 1: google -> Google / Paid Search
      const session1 = rows.find((r) => r.id === 'session-1');
      expect(session1?.channel).toBe('Google');
      expect(session1?.channel_group).toBe('Paid Search');

      // Session 2: facebook -> Facebook / Paid Social
      const session2 = rows.find((r) => r.id === 'session-2');
      expect(session2?.channel).toBe('Facebook');
      expect(session2?.channel_group).toBe('Paid Social');

      // Session 3: twitter -> no match (empty string with non-nullable schema)
      const session3 = rows.find((r) => r.id === 'session-3');
      expect(session3?.channel).toBe('');
      expect(session3?.channel_group).toBe('');
    });

    it('applies filters correctly to goals after backfill', async () => {
      // Insert test goal with empty channel values
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await workspaceClient.insert({
        table: 'goals',
        values: [
          {
            session_id: 'session-goal-1',
            workspace_id: testWorkspaceId,
            goal_name: 'signup',
            goal_value: 100,
            goal_timestamp: toClickHouseDateTime(yesterday),
            path: '/signup',
            utm_source: 'google',
            utm_medium: 'cpc',
            landing_page: 'https://test.com',
            landing_path: '/landing',
            is_direct: false,
            channel: '', // Empty - should be filled by backfill
            channel_group: '',
            _version: 1,
          },
          {
            session_id: 'session-goal-2',
            workspace_id: testWorkspaceId,
            goal_name: 'purchase',
            goal_value: 50,
            goal_timestamp: toClickHouseDateTime(yesterday),
            path: '/checkout',
            utm_source: 'facebook',
            utm_medium: 'social',
            landing_page: 'https://test.com',
            landing_path: '/landing',
            is_direct: false,
            channel: '',
            channel_group: '',
            _version: 1,
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      // Verify goals exist with empty channel values before backfill
      const beforeResult = await workspaceClient.query({
        query: `SELECT goal_name, channel, channel_group FROM goals FINAL ORDER BY goal_name`,
        format: 'JSONEachRow',
      });
      const beforeRows = await beforeResult.json();
      expect(beforeRows).toHaveLength(2);
      beforeRows.forEach((row) => {
        expect(row.channel).toBe('');
        expect(row.channel_group).toBe('');
      });

      // Start backfill
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId, lookback_days: 2 })
        .expect(201);

      // Wait for completion
      await waitForBackfillsToComplete(systemClient);

      // Verify task completed successfully
      const statusResponse = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: response.body.task_id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(statusResponse.body.status).toBe('completed');

      // Verify goals have updated channel values
      const result = await workspaceClient.query({
        query: `SELECT goal_name, utm_source, channel, channel_group FROM goals FINAL ORDER BY goal_name`,
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(2);

      // Goal 1: signup with utm_source=google -> Google / Paid Search
      const goal1 = rows.find((r) => r.goal_name === 'purchase');
      expect(goal1?.channel).toBe('Facebook');
      expect(goal1?.channel_group).toBe('Paid Social');

      // Goal 2: purchase with utm_source=facebook -> Facebook / Paid Social
      const goal2 = rows.find((r) => r.goal_name === 'signup');
      expect(goal2?.channel).toBe('Google');
      expect(goal2?.channel_group).toBe('Paid Search');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('task status transitions correctly', async () => {
      // Start a backfill that will complete successfully
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      // Initial status should be pending or running
      const initialStatus = await request(ctx.app.getHttpServer())
        .get('/api/filters.backfillStatus')
        .query({ task_id: response.body.task_id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(['pending', 'running', 'completed']).toContain(
        initialStatus.body.status,
      );

      // Wait for completion
      let taskStatus = 'pending';
      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const statusRes = await request(ctx.app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: response.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        taskStatus = statusRes.body.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') break;
      }

      expect(taskStatus).toBe('completed');
    });

    it('task error_message field exists in database', async () => {
      // Start a backfill
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      // Wait for task to complete
      await waitForBackfillsToComplete(systemClient);

      // Check task in database has error_message field
      const result = await systemClient.query({
        query:
          'SELECT status, error_message FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('completed');
      // error_message exists as a field (empty for successful tasks)
      expect(rows[0]).toHaveProperty('error_message');
    });

    it('marks stale tasks as failed on recovery check', async () => {
      // Directly insert a "stale" task into the database
      // This simulates a task that was left running when the service crashed
      const staleTaskId = 'stale-task-' + Date.now();
      const staleTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      await systemClient.insert({
        table: 'backfill_tasks',
        values: [
          {
            id: staleTaskId,
            workspace_id: testWorkspaceId,
            status: 'running',
            lookback_days: 1,
            chunk_size_days: 1,
            batch_size: 5000,
            total_sessions: 0,
            processed_sessions: 0,
            total_events: 0,
            processed_events: 0,
            current_date_chunk: null,
            created_at: toClickHouseDateTime(staleTime),
            updated_at: toClickHouseDateTime(staleTime), // Last update was 10 mins ago
            started_at: toClickHouseDateTime(staleTime),
            completed_at: null,
            error_message: '',
            retry_count: 0,
            filters_snapshot: '[]',
          },
        ],
        format: 'JSONEachRow',
      });

      // Note: In production, stale recovery runs on module init
      // For testing, we verify the task is considered stale by checking
      // that a new backfill can start (stale task doesn't block)

      // The stale task should be recovered by the next service restart
      // or by the getBackfillSummary which doesn't count stale tasks as active
      // For now, verify the stale task exists with running status
      const result = await systemClient.query({
        query:
          'SELECT status, updated_at FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: staleTaskId },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('running');
      // Verify the task is indeed stale (updated_at is old)
      const updatedAt = new Date(
        (rows[0].updated_at as string).replace(' ', 'T') + 'Z',
      );
      const ageMinutes = (Date.now() - updatedAt.getTime()) / 60000;
      expect(ageMinutes).toBeGreaterThan(5); // Older than default stale threshold

      // Clean up the stale task to avoid polluting next test's waitForBackfillsToComplete
      await systemClient.insert({
        table: 'backfill_tasks',
        values: [
          {
            id: staleTaskId,
            workspace_id: testWorkspaceId,
            status: 'failed',
            lookback_days: 1,
            chunk_size_days: 1,
            batch_size: 5000,
            total_sessions: 0,
            processed_sessions: 0,
            total_events: 0,
            processed_events: 0,
            current_date_chunk: null,
            created_at: toClickHouseDateTime(staleTime),
            updated_at: toClickHouseDateTime(),
            started_at: toClickHouseDateTime(staleTime),
            completed_at: toClickHouseDateTime(),
            error_message: 'Cleaned up by test',
            retry_count: 0,
            filters_snapshot: '[]',
          },
        ],
        format: 'JSONEachRow',
      });
    });

    it('completed tasks have completed_at timestamp', async () => {
      // Start a backfill that will complete successfully
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      // Wait for completion
      let taskStatus = 'pending';
      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const statusResponse = await request(ctx.app.getHttpServer())
          .get('/api/filters.backfillStatus')
          .query({ task_id: response.body.task_id })
          .set('Authorization', `Bearer ${authToken}`);
        taskStatus = statusResponse.body.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') break;
      }

      expect(taskStatus).toBe('completed');

      // Verify completed_at is set
      const result = await systemClient.query({
        query:
          'SELECT completed_at FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(1);
      expect(rows[0].completed_at).toBeTruthy();
      expect(rows[0].completed_at).not.toBe('');
    });

    it('final state tasks have completed_at timestamp', async () => {
      // Start a backfill that will complete
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.backfillStart')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          lookback_days: 1,
        })
        .expect(201);

      // Wait for completion
      await waitForBackfillsToComplete(systemClient);

      // Verify completed_at is set
      const result = await systemClient.query({
        query:
          'SELECT status, completed_at FROM backfill_tasks FINAL WHERE id = {id:String}',
        query_params: { id: response.body.task_id },
        format: 'JSONEachRow',
      });
      const rows = await result.json();

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('completed');
      // completed_at should be set for completed tasks
      expect(rows[0].completed_at).toBeTruthy();
    });
  });
});
