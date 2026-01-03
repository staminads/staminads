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

describe('Workspaces Integration', () => {
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
    // Clean system tables before each test
    await systemClient.command({ query: 'TRUNCATE TABLE workspaces' });
    // Wait for mutations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('POST /api/workspaces.create', () => {
    it('creates workspace and persists all fields to ClickHouse', async () => {
      const dto = {
        id: 'test_ws_1',
        name: 'Test Workspace',
        website: 'https://example.com',
        timezone: 'Europe/Paris',
        currency: 'EUR',
        logo_url: 'https://example.com/logo.png',
      };

      const response = await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Verify API response - status is 'initializing' until first event is received
      expect(response.body).toMatchObject({
        id: dto.id,
        name: dto.name,
        website: dto.website,
        timezone: dto.timezone,
        currency: dto.currency,
        logo_url: dto.logo_url,
        status: 'initializing',
        settings: {
          timescore_reference: 60,
          bounce_threshold: 10,
        },
      });
      expect(response.body.created_at).toBeDefined();
      expect(response.body.updated_at).toBeDefined();

      // Wait for insert to be visible
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify persisted in ClickHouse system database
      const result = await systemClient.query({
        query: 'SELECT * FROM workspaces WHERE id = {id:String}',
        query_params: { id: dto.id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: dto.id,
        name: dto.name,
        website: dto.website,
        timezone: dto.timezone,
        currency: dto.currency,
        logo_url: dto.logo_url,
        status: 'initializing',
      });
      // Settings is stored as JSON string in ClickHouse
      const settings = JSON.parse(rows[0].settings as string);
      expect(settings.timescore_reference).toBe(60);
      expect(settings.bounce_threshold).toBe(10);
    });

    it('creates workspace with custom bounce_threshold', async () => {
      const dto = {
        id: 'test_ws_bounce',
        name: 'Bounce Test',
        website: 'https://bounce-test.com',
        timezone: 'UTC',
        currency: 'USD',
        settings: {
          bounce_threshold: 30,
        },
      };

      const response = await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.settings.bounce_threshold).toBe(30);
    });

    it('creates workspace without optional logo_url', async () => {
      const dto = {
        id: 'test_ws_no_logo',
        name: 'No Logo Workspace',
        website: 'https://nologo.com',
        timezone: 'UTC',
        currency: 'USD',
      };

      const response = await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.id).toBe(dto.id);
      expect(response.body.logo_url).toBeUndefined();
    });

    it('rejects invalid website URL', async () => {
      const dto = {
        id: 'test_ws_invalid',
        name: 'Test',
        website: 'not-a-url',
        timezone: 'UTC',
        currency: 'USD',
      };

      await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);
    });

    it('rejects missing required fields', async () => {
      const dto = {
        id: 'test_ws_missing',
        name: 'Test',
        // missing website, timezone, currency
      };

      const response = await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);

      // ValidationPipe returns array of messages for each field
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('website')]),
      );
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .send({
          id: 'test',
          name: 'Test',
          website: 'https://test.com',
          timezone: 'UTC',
          currency: 'USD',
        })
        .expect(401);
    });
  });

  describe('GET /api/workspaces.get', () => {
    it('returns workspace by id', async () => {
      // Insert directly to ClickHouse system database
      const workspace = {
        id: 'get_test_ws',
        name: 'Get Test',
        website: 'https://get-test.com',
        timezone: 'UTC',
        currency: 'USD',
        status: 'active',
        settings: JSON.stringify({ timescore_reference: 60, bounce_threshold: 10 }),
        created_at: toClickHouseDateTime(),
        updated_at: toClickHouseDateTime(),
      };
      await systemClient.insert({
        table: 'workspaces',
        values: [workspace],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/workspaces.get')
        .query({ id: workspace.id })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(workspace.id);
      expect(response.body.name).toBe(workspace.name);
      expect(response.body.website).toBe(workspace.website);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app.getHttpServer())
        .get('/api/workspaces.get')
        .query({ id: 'nonexistent_id' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/workspaces.get')
        .query({ id: 'some_id' })
        .expect(401);
    });
  });

  describe('GET /api/workspaces.list', () => {
    it('returns all workspaces ordered by created_at DESC', async () => {
      const now = Date.now();
      const workspaces = [
        {
          id: 'ws_1',
          name: 'First',
          website: 'https://first.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          settings: JSON.stringify({ timescore_reference: 60, bounce_threshold: 10 }),
          created_at: toClickHouseDateTime(new Date(now - 2000)),
          updated_at: toClickHouseDateTime(),
        },
        {
          id: 'ws_2',
          name: 'Second',
          website: 'https://second.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          settings: JSON.stringify({ timescore_reference: 60, bounce_threshold: 10 }),
          created_at: toClickHouseDateTime(new Date(now - 1000)),
          updated_at: toClickHouseDateTime(),
        },
        {
          id: 'ws_3',
          name: 'Third',
          website: 'https://third.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          settings: JSON.stringify({ timescore_reference: 60, bounce_threshold: 10 }),
          created_at: toClickHouseDateTime(new Date(now)),
          updated_at: toClickHouseDateTime(),
        },
      ];
      await systemClient.insert({
        table: 'workspaces',
        values: workspaces,
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/workspaces.list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);
      // Most recent first
      expect(response.body[0].id).toBe('ws_3');
      expect(response.body[1].id).toBe('ws_2');
      expect(response.body[2].id).toBe('ws_1');
    });

    it('returns empty array when no workspaces exist', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/workspaces.list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/workspaces.list').expect(401);
    });
  });

  describe('POST /api/workspaces.update', () => {
    it('updates workspace fields', async () => {
      // Create workspace first
      const createDto = {
        id: 'update_test_ws',
        name: 'Original Name',
        website: 'https://original.com',
        timezone: 'UTC',
        currency: 'USD',
      };
      await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      // Update some fields
      const updateDto = {
        id: 'update_test_ws',
        name: 'Updated Name',
        timezone: 'Europe/Paris',
      };
      const response = await request(app.getHttpServer())
        .post('/api/workspaces.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(201);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.timezone).toBe('Europe/Paris');
      // Unchanged fields should be preserved
      expect(response.body.website).toBe('https://original.com');
      expect(response.body.currency).toBe('USD');
    });

    it('adds integration without clearing other fields', async () => {
      // Create workspace first
      const createDto = {
        id: 'integration_test_ws',
        name: 'Integration Test',
        website: 'https://integration-test.com',
        timezone: 'America/New_York',
        currency: 'EUR',
        logo_url: 'https://example.com/logo.png',
      };
      await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      // Update with integration only
      const updateDto = {
        id: 'integration_test_ws',
        settings: {
          integrations: [
            {
              id: 'anthropic_1',
              type: 'anthropic',
              enabled: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              settings: {
                api_key_encrypted: 'sk-ant-test-key',
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                temperature: 0.7,
              },
              limits: {
                max_requests_per_hour: 60,
                max_tokens_per_day: 100000,
              },
              usage: {
                requests_this_hour: 0,
                tokens_today: 0,
                last_reset: new Date().toISOString(),
              },
            },
          ],
        },
      };
      const response = await request(app.getHttpServer())
        .post('/api/workspaces.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(201);

      // Integration should be added
      expect(response.body.settings.integrations).toHaveLength(1);
      expect(response.body.settings.integrations[0].type).toBe('anthropic');
      // API key should be encrypted (contains ':' separators)
      expect(response.body.settings.integrations[0].settings.api_key_encrypted).toContain(':');

      // Original fields must be preserved
      expect(response.body.name).toBe('Integration Test');
      expect(response.body.website).toBe('https://integration-test.com');
      expect(response.body.timezone).toBe('America/New_York');
      expect(response.body.currency).toBe('EUR');
      expect(response.body.logo_url).toBe('https://example.com/logo.png');
    });

    it('preserves fields not included in update payload', async () => {
      // Create workspace first
      const createDto = {
        id: 'partial_update_test_ws',
        name: 'Keep This Name',
        website: 'https://keep-this.com',
        timezone: 'Asia/Tokyo',
        currency: 'JPY',
      };
      await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      // Send update with only some fields (others should be preserved)
      const updateDto = {
        id: 'partial_update_test_ws',
        settings: {
          timescore_reference: 120,
        },
      };
      const response = await request(app.getHttpServer())
        .post('/api/workspaces.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(201);

      // Original fields must be preserved
      expect(response.body.name).toBe('Keep This Name');
      expect(response.body.website).toBe('https://keep-this.com');
      expect(response.body.timezone).toBe('Asia/Tokyo');
      expect(response.body.currency).toBe('JPY');
      // Updated field should apply
      expect(response.body.settings.timescore_reference).toBe(120);
    });

    it('updates bounce_threshold', async () => {
      // Create workspace first
      const createDto = {
        id: 'bounce_update_test',
        name: 'Bounce Update Test',
        website: 'https://bounce-update.com',
        timezone: 'UTC',
        currency: 'USD',
      };
      await request(app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(createDto)
        .expect(201);

      // Update bounce_threshold
      const response = await request(app.getHttpServer())
        .post('/api/workspaces.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'bounce_update_test', settings: { bounce_threshold: 20 } })
        .expect(201);

      expect(response.body.settings.bounce_threshold).toBe(20);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app.getHttpServer())
        .post('/api/workspaces.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'nonexistent_id', name: 'Test' })
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/workspaces.update')
        .send({ id: 'some_id', name: 'Test' })
        .expect(401);
    });
  });

  describe('POST /api/workspaces.delete', () => {
    it('deletes workspace from ClickHouse', async () => {
      const workspace = {
        id: 'delete_test_ws',
        name: 'Delete Test',
        website: 'https://delete.com',
        timezone: 'UTC',
        currency: 'USD',
        status: 'active',
        settings: JSON.stringify({ timescore_reference: 60, bounce_threshold: 10 }),
        created_at: toClickHouseDateTime(),
        updated_at: toClickHouseDateTime(),
      };
      await systemClient.insert({
        table: 'workspaces',
        values: [workspace],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      await request(app.getHttpServer())
        .post('/api/workspaces.delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: workspace.id })
        .expect(200);

      // Wait for delete mutation to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify deleted from ClickHouse system database
      const result = await systemClient.query({
        query: 'SELECT * FROM workspaces WHERE id = {id:String}',
        query_params: { id: workspace.id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(0);
    });

    it('returns 404 for non-existent workspace', async () => {
      await request(app.getHttpServer())
        .post('/api/workspaces.delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'nonexistent_id' })
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/workspaces.delete')
        .send({ id: 'some_id' })
        .expect(401);
    });
  });

  describe('Table Schema Verification', () => {
    it('workspaces table has all required columns with correct types', async () => {
      const result = await systemClient.query({
        query: 'DESCRIBE TABLE workspaces',
        format: 'JSONEachRow',
      });
      const columns = (await result.json()) as Array<{
        name: string;
        type: string;
      }>;
      const columnMap = Object.fromEntries(columns.map((c) => [c.name, c.type]));

      expect(columnMap['id']).toBe('String');
      expect(columnMap['name']).toBe('String');
      expect(columnMap['website']).toBe('String');
      expect(columnMap['timezone']).toBe('String');
      expect(columnMap['currency']).toBe('String');
      expect(columnMap['logo_url']).toMatch(/Nullable\(String\)/);
      expect(columnMap['settings']).toBe('String');
      expect(columnMap['status']).toMatch(/Enum8/);
      expect(columnMap['created_at']).toMatch(/DateTime64/);
      expect(columnMap['updated_at']).toMatch(/DateTime64/);
    });

    it('sessions table has all required columns (in workspace database)', async () => {
      const result = await workspaceClient.query({
        query: 'DESCRIBE TABLE sessions',
        format: 'JSONEachRow',
      });
      const columns = (await result.json()) as Array<{
        name: string;
        type: string;
      }>;
      const columnNames = columns.map((c) => c.name);

      // Core fields
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('workspace_id');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
      expect(columnNames).toContain('duration');

      // Time breakdown fields
      expect(columnNames).toContain('year');
      expect(columnNames).toContain('month');
      expect(columnNames).toContain('day');
      expect(columnNames).toContain('hour');
      expect(columnNames).toContain('is_weekend');

      // UTM fields
      expect(columnNames).toContain('utm_source');
      expect(columnNames).toContain('utm_medium');
      expect(columnNames).toContain('utm_campaign');

      // Device fields
      expect(columnNames).toContain('browser');
      expect(columnNames).toContain('os');
      expect(columnNames).toContain('device');

      // Landing/exit paths
      expect(columnNames).toContain('landing_path');
      expect(columnNames).toContain('exit_path');
    });

    it('events table has all required columns (in workspace database)', async () => {
      const result = await workspaceClient.query({
        query: 'DESCRIBE TABLE events',
        format: 'JSONEachRow',
      });
      const columns = (await result.json()) as Array<{
        name: string;
        type: string;
      }>;
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('session_id');
      expect(columnNames).toContain('workspace_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('path');
      expect(columnNames).toContain('landing_page');
    });
  });
});
