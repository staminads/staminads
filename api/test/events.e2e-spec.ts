import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EventBufferService } from '../src/events/event-buffer.service';
import { generateApiKeyToken } from '../src/common/crypto';

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
  let apiKey: string; // Raw API key token

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
    await systemClient.command({ query: 'TRUNCATE TABLE api_keys' });
    await workspaceClient.command({ query: 'TRUNCATE TABLE events' });
    await workspaceClient.command({ query: 'TRUNCATE TABLE sessions' });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  async function createTestWorkspace(
    id: string = testWorkspaceId,
  ): Promise<string> {
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

  async function createTestApiKey(
    workspaceId: string,
    scopes: string[] = ['events.track'],
  ): Promise<string> {
    const { key, hash, prefix } = generateApiKeyToken();
    const now = toClickHouseDateTime();

    await systemClient.insert({
      table: 'api_keys',
      values: [
        {
          id: `key-${Date.now()}`,
          key_hash: hash,
          key_prefix: prefix,
          user_id: 'test-user',
          workspace_id: workspaceId,
          name: 'Test API Key',
          description: '',
          scopes: JSON.stringify(scopes),
          status: 'active',
          expires_at: null,
          last_used_at: null,
          failed_attempts_count: 0,
          last_failed_attempt_at: null,
          created_by: 'test-user',
          revoked_by: null,
          revoked_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    return key;
  }

  describe('POST /api/track', () => {
    beforeEach(async () => {
      const workspaceId = await createTestWorkspace();
      apiKey = await createTestApiKey(workspaceId);
    });

    it('accepts event and stores in ClickHouse', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-1',
          name: 'screen_view',
          path: '/test-page',
          landing_page: 'https://test.com/test-page',
          created_at: Date.now(),
          updated_at: Date.now(),
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
      const events = (await result.json()) as Record<string, unknown>[];

      expect(events).toHaveLength(1);
      expect(events[0].workspace_id).toBe(testWorkspaceId);
      expect(events[0].name).toBe('screen_view');
      expect(events[0].path).toBe('/test-page');
    });

    it('rejects invalid workspace_id', async () => {
      await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: 'non-existent',
          session_id: 'test',
          name: 'screen_view',
          path: '/test',
          landing_page: 'https://test.com/test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(403); // Forbidden - API key not authorized for this workspace
    });

    it('requires API key authentication', async () => {
      // Note: No Authorization header
      const response = await request(app.getHttpServer())
        .post('/api/track')
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-no-auth',
          name: 'screen_view',
          path: '/no-auth-test',
          landing_page: 'https://test.com/no-auth-test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(401);

      expect(response.body.message).toBe('Unauthorized');
    });

    it('rejects invalid API key format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', 'Bearer invalid_token_format')
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-invalid',
          name: 'screen_view',
          path: '/invalid-test',
          landing_page: 'https://test.com/invalid-test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid API key format');
    });

    it('rejects API key for different workspace', async () => {
      // Create another workspace
      await createTestWorkspace('other_ws');
      const otherApiKey = await createTestApiKey('other_ws');

      await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${otherApiKey}`)
        .send({
          workspace_id: testWorkspaceId, // Trying to use API key from other_ws
          session_id: 'session-wrong-ws',
          name: 'screen_view',
          path: '/wrong-ws-test',
          landing_page: 'https://test.com/wrong-ws-test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(403);
    });

    it('rejects API key without events.track scope', async () => {
      const readOnlyKey = await createTestApiKey(testWorkspaceId, [
        'analytics.view',
      ]);

      const response = await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${readOnlyKey}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-no-scope',
          name: 'screen_view',
          path: '/no-scope-test',
          landing_page: 'https://test.com/no-scope-test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(403);

      expect(response.body.message).toBe(
        'Missing required scope: events.track',
      );
    });

    it('rejects revoked API key', async () => {
      // Create and revoke an API key
      const { key, hash, prefix } = generateApiKeyToken();
      const now = toClickHouseDateTime();

      await systemClient.insert({
        table: 'api_keys',
        values: [
          {
            id: 'revoked-key',
            key_hash: hash,
            key_prefix: prefix,
            user_id: 'test-user',
            workspace_id: testWorkspaceId,
            name: 'Revoked API Key',
            description: '',
            scopes: JSON.stringify(['events.track']),
            status: 'revoked',
            expires_at: null,
            last_used_at: null,
            failed_attempts_count: 0,
            last_failed_attempt_at: null,
            created_by: 'test-user',
            revoked_by: 'admin',
            revoked_at: now,
            created_at: now,
            updated_at: now,
          },
        ],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${key}`)
        .send({
          workspace_id: testWorkspaceId,
          session_id: 'session-revoked',
          name: 'screen_view',
          path: '/revoked-test',
          landing_page: 'https://test.com/revoked-test',
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .expect(401);

      expect(response.body.message).toBe('API key is revoked');
    });

    it('rejects missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/api/track')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          // missing session_id, name, path, landing_page
        })
        .expect(400);
    });
  });

  describe('POST /api/track.batch', () => {
    beforeEach(async () => {
      const workspaceId = await createTestWorkspace();
      apiKey = await createTestApiKey(workspaceId);
    });

    it('accepts batch of events', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/track.batch')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          events: [
            {
              workspace_id: testWorkspaceId,
              session_id: 'batch-session-1',
              name: 'screen_view',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
            {
              workspace_id: testWorkspaceId,
              session_id: 'batch-session-1',
              name: 'scroll',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
              max_scroll: 50,
              created_at: Date.now(),
              updated_at: Date.now(),
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
      const events = (await result.json()) as Record<string, unknown>[];

      expect(events).toHaveLength(2);
    });

    it('rejects mixed workspace_ids in batch', async () => {
      await createTestWorkspace('ws-2');

      await request(app.getHttpServer())
        .post('/api/track.batch')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          events: [
            {
              workspace_id: testWorkspaceId,
              session_id: 'session-1',
              name: 'screen_view',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
            {
              workspace_id: 'ws-2', // Different workspace
              session_id: 'session-1',
              name: 'scroll',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          ],
        })
        .expect(400);
    });

    it('handles empty batch', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/track.batch')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ events: [] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(0);
    });

    it('requires API key authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/track.batch')
        .send({
          events: [
            {
              workspace_id: testWorkspaceId,
              session_id: 'batch-no-auth',
              name: 'screen_view',
              path: '/page-1',
              landing_page: 'https://test.com/page-1',
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          ],
        })
        .expect(401);
    });
  });

  describe('Materialized View', () => {
    beforeEach(async () => {
      const workspaceId = await createTestWorkspace();
      apiKey = await createTestApiKey(workspaceId);
    });

    it('populates sessions table from events', async () => {
      const sessionId = 'mv-test-session';

      // Insert multiple events for same session
      const now = Date.now();
      const events = [
        {
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/entry-page',
          landing_page: 'https://test.com/entry-page',
          created_at: now,
          updated_at: now,
        },
        {
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'scroll',
          path: '/entry-page',
          landing_page: 'https://test.com/entry-page',
          max_scroll: 75,
          created_at: now,
          updated_at: now + 100,
        },
        {
          workspace_id: testWorkspaceId,
          session_id: sessionId,
          name: 'screen_view',
          path: '/exit-page',
          landing_page: 'https://test.com/entry-page',
          created_at: now,
          updated_at: now + 200,
        },
      ];

      for (const event of events) {
        await request(app.getHttpServer())
          .post('/api/track')
          .set('Authorization', `Bearer ${apiKey}`)
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
        query: 'SELECT * FROM sessions FINAL WHERE id = {id:String} LIMIT 1',
        query_params: { id: sessionId },
        format: 'JSONEachRow',
      });
      const sessions = (await result.json()) as Record<string, unknown>[];

      expect(sessions).toHaveLength(1);
      const session = sessions[0];

      expect(session.workspace_id).toBe(testWorkspaceId);
      expect(session.landing_path).toBe('/entry-page');
      expect(session.exit_path).toBe('/exit-page');
      expect(session.max_scroll).toBe(75);
      // Duration should be calculated (might be small due to quick test)
      expect(typeof session.duration).toBe('number');
    });
  });
});
