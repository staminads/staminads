import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EventBufferService } from '../src/events/event-buffer.service';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';
// Workspace ID used in tests - must match what's passed to createTestWorkspace
const testWorkspaceId = 'test_ws';
// DB name = staminads_ws_<workspace_id> (matches what ClickHouseService.getWorkspaceDatabaseName returns)
const TEST_WORKSPACE_DATABASE = `staminads_ws_${testWorkspaceId}`;

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

describe('Events Integration', () => {
  let app: INestApplication;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let authToken: string;
  let eventBuffer: EventBufferService;

  beforeAll(async () => {
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

    eventBuffer = moduleFixture.get<EventBufferService>(EventBufferService);

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
    await workspaceClient.command({ query: 'TRUNCATE TABLE events' });
    await workspaceClient.command({ query: 'TRUNCATE TABLE sessions' });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  async function createTestWorkspace(id: string = testWorkspaceId): Promise<string> {
    const workspace = {
      id,
      name: 'Test Workspace',
      website: 'https://test.com',
      timezone: 'UTC',
      currency: 'USD',
      status: 'active',
      timescore_reference: 60,
      created_at: toClickHouseDateTime(),
      updated_at: toClickHouseDateTime(),
    };
    await systemClient.insert({
      table: 'workspaces',
      values: [workspace],
      format: 'JSONEachRow',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return id;
  }

  describe('POST /api/track', () => {
    it('accepts event and stores in ClickHouse', async () => {
      const workspaceId = await createTestWorkspace();

      const response = await request(app.getHttpServer())
        .post('/api/track')
        .send({
          workspace_id: workspaceId,
          session_id: 'session-1',
          name: 'screen_view',
          path: '/test-page',
          landing_page: 'https://test.com/test-page',
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Flush buffer to ensure event is written
      await eventBuffer.flushAll();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify event in ClickHouse workspace database
      const result = await workspaceClient.query({
        query:
          'SELECT * FROM events WHERE session_id = {session_id:String} LIMIT 1',
        query_params: { session_id: 'session-1' },
        format: 'JSONEachRow',
      });
      const events = (await result.json()) as Array<Record<string, unknown>>;

      expect(events).toHaveLength(1);
      expect(events[0].workspace_id).toBe(workspaceId);
      expect(events[0].name).toBe('screen_view');
      expect(events[0].path).toBe('/test-page');
    });

    it('rejects invalid workspace_id', async () => {
      await request(app.getHttpServer())
        .post('/api/track')
        .send({
          workspace_id: 'non-existent',
          session_id: 'test',
          name: 'screen_view',
          path: '/test',
          landing_page: 'https://test.com/test',
        })
        .expect(400);
    });

    it('is public (no auth required)', async () => {
      const workspaceId = await createTestWorkspace();

      // Note: No Authorization header
      const response = await request(app.getHttpServer())
        .post('/api/track')
        .send({
          workspace_id: workspaceId,
          session_id: 'session-public',
          name: 'screen_view',
          path: '/public-test',
          landing_page: 'https://test.com/public-test',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('rejects missing required fields', async () => {
      const workspaceId = await createTestWorkspace();

      await request(app.getHttpServer())
        .post('/api/track')
        .send({
          workspace_id: workspaceId,
          // missing session_id, name, path, landing_page
        })
        .expect(400);
    });
  });

  describe('POST /api/track.batch', () => {
    it('accepts batch of events', async () => {
      const workspaceId = await createTestWorkspace();

      const response = await request(app.getHttpServer())
        .post('/api/track.batch')
        .send({
          events: [
            {
              workspace_id: workspaceId,
              session_id: 'batch-session-1',
              name: 'screen_view',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
            },
            {
              workspace_id: workspaceId,
              session_id: 'batch-session-1',
              name: 'scroll',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
              max_scroll: 50,
            },
          ],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(2);

      // Flush buffer
      await eventBuffer.flushAll();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify events in ClickHouse workspace database
      const result = await workspaceClient.query({
        query:
          'SELECT * FROM events WHERE session_id = {session_id:String} ORDER BY created_at',
        query_params: { session_id: 'batch-session-1' },
        format: 'JSONEachRow',
      });
      const events = (await result.json()) as Array<Record<string, unknown>>;

      expect(events).toHaveLength(2);
    });

    it('rejects mixed workspace_ids in batch', async () => {
      const workspaceId = await createTestWorkspace('ws-1');
      await createTestWorkspace('ws-2');

      await request(app.getHttpServer())
        .post('/api/track.batch')
        .send({
          events: [
            {
              workspace_id: workspaceId,
              session_id: 'session-1',
              name: 'screen_view',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
            },
            {
              workspace_id: 'ws-2', // Different workspace
              session_id: 'session-1',
              name: 'scroll',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
            },
          ],
        })
        .expect(400);
    });

    it('handles empty batch', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/track.batch')
        .send({ events: [] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(0);
    });
  });

  describe('Materialized View', () => {
    it('populates sessions table from events', async () => {
      const workspaceId = await createTestWorkspace();
      const sessionId = 'mv-test-session';

      // Insert multiple events for same session
      const events = [
        {
          workspace_id: workspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/entry-page',
          landing_page: 'https://test.com/entry-page',
        },
        {
          workspace_id: workspaceId,
          session_id: sessionId,
          name: 'scroll',
          path: '/entry-page',
          landing_page: 'https://test.com/entry-page',
          max_scroll: 75,
        },
        {
          workspace_id: workspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/exit-page',
          landing_page: 'https://test.com/entry-page',
        },
      ];

      for (const event of events) {
        await request(app.getHttpServer())
          .post('/api/track')
          .send(event)
          .expect(200);
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Flush buffer
      await eventBuffer.flushAll();
      // Wait for MV to populate sessions
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Query sessions table in workspace database (with FINAL to deduplicate)
      const result = await workspaceClient.query({
        query:
          'SELECT * FROM sessions FINAL WHERE id = {id:String} LIMIT 1',
        query_params: { id: sessionId },
        format: 'JSONEachRow',
      });
      const sessions = (await result.json()) as Array<Record<string, unknown>>;

      expect(sessions).toHaveLength(1);
      const session = sessions[0];

      expect(session.workspace_id).toBe(workspaceId);
      expect(session.entry_page).toBe('/entry-page');
      expect(session.exit_page).toBe('/exit-page');
      expect(session.max_scroll).toBe(75);
      // Duration should be calculated (might be small due to quick test)
      expect(typeof session.duration).toBe('number');
    });
  });
});
