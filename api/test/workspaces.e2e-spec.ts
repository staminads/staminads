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
        id: 'test-ws-1',
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

      // Verify API response
      expect(response.body).toMatchObject({
        id: dto.id,
        name: dto.name,
        website: dto.website,
        timezone: dto.timezone,
        currency: dto.currency,
        logo_url: dto.logo_url,
        status: 'initializing',
        timescore_reference: 60,
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
        timescore_reference: 60,
      });
    });

    it('creates workspace without optional logo_url', async () => {
      const dto = {
        id: 'test-ws-no-logo',
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
        id: 'test-ws-invalid',
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
        id: 'test-ws-missing',
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
        id: 'get-test-ws',
        name: 'Get Test',
        website: 'https://get-test.com',
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
        .query({ id: 'non-existent-id' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/workspaces.get')
        .query({ id: 'some-id' })
        .expect(401);
    });
  });

  describe('GET /api/workspaces.list', () => {
    it('returns all workspaces ordered by created_at DESC', async () => {
      const now = Date.now();
      const workspaces = [
        {
          id: 'ws-1',
          name: 'First',
          website: 'https://first.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          timescore_reference: 60,
          created_at: toClickHouseDateTime(new Date(now - 2000)),
          updated_at: toClickHouseDateTime(),
        },
        {
          id: 'ws-2',
          name: 'Second',
          website: 'https://second.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          timescore_reference: 60,
          created_at: toClickHouseDateTime(new Date(now - 1000)),
          updated_at: toClickHouseDateTime(),
        },
        {
          id: 'ws-3',
          name: 'Third',
          website: 'https://third.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          timescore_reference: 60,
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
      expect(response.body[0].id).toBe('ws-3');
      expect(response.body[1].id).toBe('ws-2');
      expect(response.body[2].id).toBe('ws-1');
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

  describe('POST /api/workspaces.delete', () => {
    it('deletes workspace from ClickHouse', async () => {
      const workspace = {
        id: 'delete-test-ws',
        name: 'Delete Test',
        website: 'https://delete.com',
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
        .send({ id: 'non-existent-id' })
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/workspaces.delete')
        .send({ id: 'some-id' })
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
      expect(columnMap['timescore_reference']).toMatch(/UInt32/);
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

      // Entry/exit pages
      expect(columnNames).toContain('entry_page');
      expect(columnNames).toContain('exit_page');
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
