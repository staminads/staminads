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

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

describe('API Keys Integration', () => {
  let app: INestApplication;
  let systemClient: ClickHouseClient;
  let authToken: string;
  let authUserId: string;

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

    // Direct ClickHouse client for verification
    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_SYSTEM_DATABASE,
    });

    // Create test user for this test suite
    const testEmail = 'apikeys-test@test.com';
    const testPassword = 'password123';
    const passwordHash = await hashPassword(testPassword);
    const now = toClickHouseDateTime();

    await systemClient.insert({
      table: 'users',
      values: [
        {
          id: generateId(),
          email: testEmail,
          password_hash: passwordHash,
          name: 'API Keys Test User',
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
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get auth token and user ID
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({ email: testEmail, password: testPassword });

    expect(loginRes.status).toBe(201);
    expect(loginRes.body.access_token).toBeDefined();
    expect(loginRes.body.user).toBeDefined();
    authToken = loginRes.body.access_token;
    authUserId = loginRes.body.user.id;
  });

  afterAll(async () => {
    await systemClient.close();
    await app.close();
  });

  beforeEach(async () => {
    // Clean api_keys table before each test
    await systemClient.command({ query: 'TRUNCATE TABLE api_keys' });
    // Wait for mutations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('POST /api/apiKeys.create', () => {
    it('creates API key and returns full key only once', async () => {
      // Note: user_id is now taken from authenticated user (JWT), not from request body
      const dto = {
        workspace_id: 'test_ws_1',
        name: 'Test API Key',
        description: 'For testing purposes',
        scopes: ['analytics:write', 'analytics:read'],
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Verify response structure
      expect(response.body.key).toBeDefined();
      expect(response.body.key).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(response.body.apiKey).toBeDefined();
      expect(response.body.apiKey.id).toBeDefined();
      expect(response.body.apiKey.name).toBe(dto.name);
      expect(response.body.apiKey.description).toBe(dto.description);
      expect(response.body.apiKey.user_id).toBe(authUserId); // Uses authenticated user
      expect(response.body.apiKey.workspace_id).toBe(dto.workspace_id);
      expect(response.body.apiKey.scopes).toEqual(dto.scopes);
      expect(response.body.apiKey.status).toBe('active');
      expect(response.body.apiKey.key_hash).toBeUndefined(); // Should not expose key_hash
      expect(response.body.apiKey.key_prefix).toBeDefined();
      expect(response.body.apiKey.created_at).toBeDefined();

      // Wait for insert to be visible
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify persisted in ClickHouse
      const result = await systemClient.query({
        query: 'SELECT * FROM api_keys WHERE id = {id:String}',
        query_params: { id: response.body.apiKey.id },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Record<string, unknown>[];

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(response.body.apiKey.id);
      expect(rows[0].name).toBe(dto.name);
      expect(rows[0].user_id).toBe(authUserId); // Uses authenticated user
      expect(rows[0].workspace_id).toBe(dto.workspace_id);
      expect(rows[0].key_hash).toBeDefined();
      expect(rows[0].key_prefix).toBeDefined();
      expect(rows[0].status).toBe('active');
      const scopes = JSON.parse(rows[0].scopes as string);
      expect(scopes).toEqual(dto.scopes);
    });

    it('creates API key with all scopes', async () => {
      const dto = {
        workspace_id: 'test_ws_2',
        name: 'Full Access Key',
        scopes: [
          'analytics:write',
          'analytics:read',
          'workspace:read',
          'workspace:manage',
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.apiKey.scopes).toHaveLength(4);
      expect(response.body.apiKey.scopes).toEqual(
        expect.arrayContaining([
          'analytics:write',
          'analytics:read',
          'workspace:read',
          'workspace:manage',
        ]),
      );
    });

    it('creates API key with expiration date', async () => {
      const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      const dto = {
        workspace_id: 'test_ws_3',
        name: 'Temporary Key',
        scopes: ['analytics:read'],
        expires_at: expirationDate.toISOString(),
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.apiKey.expires_at).toBeDefined();
      // Verify the expiration date is close to what we sent
      const responseExpiry = new Date(response.body.apiKey.expires_at);
      const timeDiff = Math.abs(
        responseExpiry.getTime() - expirationDate.getTime(),
      );
      expect(timeDiff).toBeLessThan(2000); // Within 2 seconds
    });

    it('creates API key without workspace_id (user-level key)', async () => {
      const dto = {
        workspace_id: null,
        name: 'User-level Key',
        scopes: ['analytics:read'],
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.apiKey.workspace_id).toBeNull();
    });

    it('creates API key without optional description', async () => {
      const dto = {
        workspace_id: 'test_ws_4',
        name: 'No Description Key',
        scopes: ['analytics:write'],
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.apiKey.description).toBe('');
    });

    it('rejects creation without authentication', async () => {
      const dto = {
        workspace_id: 'test_ws_5',
        name: 'Unauthorized Key',
        scopes: ['analytics:read'],
      };

      await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .send(dto)
        .expect(401);
    });

    it('rejects creation with missing required fields', async () => {
      const dto = {
        // missing name and scopes (user_id is optional - comes from JWT)
        workspace_id: 'test_ws_missing',
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('name'),
          expect.stringContaining('scopes'),
        ]),
      );
    });

    it('rejects creation with empty scopes array', async () => {
      const dto = {
        workspace_id: 'test_ws_6',
        name: 'No Scopes Key',
        scopes: [],
      };

      await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);
    });

    it('rejects creation with name too long', async () => {
      const dto = {
        workspace_id: 'test_ws_7',
        name: 'A'.repeat(101), // Max length is 100
        scopes: ['analytics:read'],
      };

      await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);
    });

    it('creates API key without user_id in body (uses authenticated user)', async () => {
      // This simulates what the frontend actually sends - no user_id
      const dto = {
        workspace_id: 'test_ws_frontend',
        name: 'Frontend Created Key',
        description: 'Created without explicit user_id',
        scopes: ['analytics:read'],
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Verify response structure
      expect(response.body.key).toBeDefined();
      expect(response.body.key).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(response.body.apiKey).toBeDefined();
      expect(response.body.apiKey.id).toBeDefined();
      expect(response.body.apiKey.name).toBe(dto.name);
      expect(response.body.apiKey.workspace_id).toBe(dto.workspace_id);
      // user_id should be set from JWT token (authenticated user)
      expect(response.body.apiKey.user_id).toBeDefined();
      expect(typeof response.body.apiKey.user_id).toBe('string');
      expect(response.body.apiKey.user_id.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/apiKeys.list', () => {
    beforeEach(async () => {
      // Insert test API keys directly to ClickHouse
      const now = toClickHouseDateTime();
      const apiKeys = [
        {
          id: 'key_1',
          key_hash: 'hash_1',
          key_prefix: 'sk_live_abc1',
          user_id: 'user_123',
          workspace_id: 'workspace_1',
          name: 'Key 1',
          description: 'First key',
          scopes: JSON.stringify(['analytics:read']),
          status: 'active',
          expires_at: null,
          last_used_at: null,
          failed_attempts_count: 0,
          last_failed_attempt_at: null,
          created_by: 'admin',
          revoked_by: null,
          revoked_at: null,
          created_at: toClickHouseDateTime(new Date(Date.now() - 3000)),
          updated_at: now,
        },
        {
          id: 'key_2',
          key_hash: 'hash_2',
          key_prefix: 'sk_live_abc2',
          user_id: 'user_123',
          workspace_id: 'workspace_2',
          name: 'Key 2',
          description: 'Second key',
          scopes: JSON.stringify(['analytics:write']),
          status: 'active',
          expires_at: null,
          last_used_at: null,
          failed_attempts_count: 0,
          last_failed_attempt_at: null,
          created_by: 'admin',
          revoked_by: null,
          revoked_at: null,
          created_at: toClickHouseDateTime(new Date(Date.now() - 2000)),
          updated_at: now,
        },
        {
          id: 'key_3',
          key_hash: 'hash_3',
          key_prefix: 'sk_live_abc3',
          user_id: 'user_456',
          workspace_id: 'workspace_1',
          name: 'Key 3',
          description: 'Third key',
          scopes: JSON.stringify(['workspace:read']),
          status: 'revoked',
          expires_at: null,
          last_used_at: null,
          failed_attempts_count: 0,
          last_failed_attempt_at: null,
          created_by: 'admin',
          revoked_by: 'admin',
          revoked_at: now,
          created_at: toClickHouseDateTime(new Date(Date.now() - 1000)),
          updated_at: now,
        },
      ];

      await systemClient.insert({
        table: 'api_keys',
        values: apiKeys,
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('returns all API keys for user without key_hash', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ user_id: 'user_123' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBeDefined();
      expect(response.body[0].name).toBeDefined();
      expect(response.body[0].key_hash).toBeUndefined(); // Should not expose key_hash
      expect(response.body[0].key_prefix).toBeDefined();
      // Most recent first
      expect(response.body[0].id).toBe('key_2');
      expect(response.body[1].id).toBe('key_1');
    });

    it('filters API keys by workspace_id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ workspace_id: 'workspace_1' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((k: Record<string, unknown>) => k.workspace_id === 'workspace_1')).toBe(
        true,
      );
    });

    it('filters API keys by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ status: 'revoked' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('key_3');
      expect(response.body[0].status).toBe('revoked');
    });

    it('filters API keys by active status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ status: 'active' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((k: Record<string, unknown>) => k.status === 'active')).toBe(true);
    });

    it('combines multiple filters (user_id and workspace_id)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ user_id: 'user_123', workspace_id: 'workspace_1' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('key_1');
      expect(response.body[0].user_id).toBe('user_123');
      expect(response.body[0].workspace_id).toBe('workspace_1');
    });

    it('returns empty array when no keys match filters', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ user_id: 'nonexistent_user' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns all keys when no filters provided', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ user_id: 'user_123' })
        .expect(401);
    });
  });

  describe('GET /api/apiKeys.get', () => {
    beforeEach(async () => {
      // Insert test API key
      const now = toClickHouseDateTime();
      const apiKey = {
        id: 'get_test_key',
        key_hash: 'hash_get_test',
        key_prefix: 'sk_live_gettest',
        user_id: 'user_get_test',
        workspace_id: 'workspace_get_test',
        name: 'Get Test Key',
        description: 'For get endpoint testing',
        scopes: JSON.stringify(['analytics:read', 'workspace:read']),
        status: 'active',
        expires_at: null,
        last_used_at: null,
        failed_attempts_count: 0,
        last_failed_attempt_at: null,
        created_by: 'admin',
        revoked_by: null,
        revoked_at: null,
        created_at: now,
        updated_at: now,
      };

      await systemClient.insert({
        table: 'api_keys',
        values: [apiKey],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('returns single API key by id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.get')
        .query({ id: 'get_test_key' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe('get_test_key');
      expect(response.body.name).toBe('Get Test Key');
      expect(response.body.user_id).toBe('user_get_test');
      expect(response.body.workspace_id).toBe('workspace_get_test');
      expect(response.body.key_hash).toBeUndefined(); // Should not expose key_hash
      expect(response.body.key_prefix).toBe('sk_live_gettest');
      expect(response.body.scopes).toEqual(['analytics:read', 'workspace:read']);
      expect(response.body.status).toBe('active');
    });

    it('returns 404 for non-existent API key', async () => {
      await request(app.getHttpServer())
        .get('/api/apiKeys.get')
        .query({ id: 'nonexistent_key_id' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/apiKeys.get')
        .query({ id: 'get_test_key' })
        .expect(401);
    });
  });

  describe('POST /api/apiKeys.revoke', () => {
    let testKeyId: string;

    beforeEach(async () => {
      // Insert test API key
      const now = toClickHouseDateTime();
      testKeyId = 'revoke_test_key';
      const apiKey = {
        id: testKeyId,
        key_hash: 'hash_revoke_test',
        key_prefix: 'sk_live_revoketest',
        user_id: 'user_revoke_test',
        workspace_id: 'workspace_revoke_test',
        name: 'Revoke Test Key',
        description: 'For revoke endpoint testing',
        scopes: JSON.stringify(['analytics:write']),
        status: 'active',
        expires_at: null,
        last_used_at: null,
        failed_attempts_count: 0,
        last_failed_attempt_at: null,
        created_by: 'admin',
        revoked_by: null,
        revoked_at: null,
        created_at: now,
        updated_at: now,
      };

      await systemClient.insert({
        table: 'api_keys',
        values: [apiKey],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('marks API key as revoked', async () => {
      const dto = {
        id: testKeyId,
        revoked_by: 'admin_user',
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(200);

      expect(response.body.id).toBe(testKeyId);
      expect(response.body.status).toBe('revoked');
      expect(response.body.revoked_by).toBe('admin_user');
      expect(response.body.revoked_at).toBeDefined();

      // Wait for mutation to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify in database
      const result = await systemClient.query({
        query:
          'SELECT * FROM api_keys WHERE id = {id:String} ORDER BY updated_at DESC LIMIT 1',
        query_params: { id: testKeyId },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Record<string, unknown>[];

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('revoked');
      expect(rows[0].revoked_by).toBe('admin_user');
      expect(rows[0].revoked_at).toBeDefined();
    });

    it('returns 404 for non-existent API key', async () => {
      const dto = {
        id: 'nonexistent_key',
        revoked_by: 'admin_user',
      };

      await request(app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(404);
    });

    it('can revoke already revoked key', async () => {
      // First revocation
      await request(app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: testKeyId, revoked_by: 'first_admin' })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second revocation (should succeed)
      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: testKeyId, revoked_by: 'second_admin' })
        .expect(200);

      expect(response.body.status).toBe('revoked');
      // Should update to new revoked_by
      expect(response.body.revoked_by).toBe('second_admin');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .send({ id: testKeyId, revoked_by: 'admin_user' })
        .expect(401);
    });
  });

  describe('API Key Expiration', () => {
    it('creates API key with expired date', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      const dto = {
        workspace_id: 'test_ws_expired',
        name: 'Expired Key',
        scopes: ['analytics:read'],
        expires_at: pastDate.toISOString(),
      };

      const response = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Key is created as 'active' - expiration check happens during validation
      expect(response.body.apiKey.status).toBe('active');
      expect(response.body.apiKey.expires_at).toBeDefined();
    });

    it('lists API keys that have passed expiration date', async () => {
      // Insert expired key
      const now = toClickHouseDateTime();
      const expiredKey = {
        id: 'expired_key',
        key_hash: 'hash_expired',
        key_prefix: 'sk_live_expired',
        user_id: 'user_exp',
        workspace_id: 'workspace_exp',
        name: 'Expired Key',
        description: '',
        scopes: JSON.stringify(['analytics:read']),
        status: 'expired',
        expires_at: toClickHouseDateTime(
          new Date(Date.now() - 24 * 60 * 60 * 1000),
        ),
        last_used_at: null,
        failed_attempts_count: 0,
        last_failed_attempt_at: null,
        created_by: 'admin',
        revoked_by: null,
        revoked_at: null,
        created_at: now,
        updated_at: now,
      };

      await systemClient.insert({
        table: 'api_keys',
        values: [expiredKey],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ status: 'expired' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('expired_key');
      expect(response.body[0].status).toBe('expired');
    });
  });

  describe('API Key Metadata', () => {
    it('stores and retrieves all metadata fields', async () => {
      const dto = {
        workspace_id: 'workspace_metadata',
        name: 'Metadata Test Key',
        description: 'Full metadata test',
        scopes: ['analytics:write', 'analytics:read'],
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      const keyId = createResponse.body.apiKey.id;

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Retrieve and verify all fields
      const getResponse = await request(app.getHttpServer())
        .get('/api/apiKeys.get')
        .query({ id: keyId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getResponse.body).toMatchObject({
        id: keyId,
        user_id: authUserId, // Uses authenticated user
        workspace_id: dto.workspace_id,
        name: dto.name,
        description: dto.description,
        scopes: dto.scopes,
        status: 'active',
        last_used_at: null,
        failed_attempts_count: 0,
        last_failed_attempt_at: null,
        revoked_by: null,
        revoked_at: null,
      });
      expect(getResponse.body.expires_at).toBeDefined();
      expect(getResponse.body.created_at).toBeDefined();
      expect(getResponse.body.updated_at).toBeDefined();
      expect(getResponse.body.created_by).toBeDefined();
    });
  });

  describe('Table Schema Verification', () => {
    it('api_keys table has all required columns with correct types', async () => {
      const result = await systemClient.query({
        query: 'DESCRIBE TABLE api_keys',
        format: 'JSONEachRow',
      });
      const columns = (await result.json()) as Record<string, unknown>[];
      const columnMap = Object.fromEntries(
        columns.map((c) => [c.name, c.type]),
      );

      expect(columnMap['id']).toBe('String');
      expect(columnMap['key_hash']).toBe('String');
      expect(columnMap['key_prefix']).toBe('String');
      expect(columnMap['user_id']).toBe('String');
      expect(columnMap['workspace_id']).toMatch(/Nullable\(String\)/);
      expect(columnMap['name']).toBe('String');
      expect(columnMap['description']).toBe('String');
      expect(columnMap['scopes']).toBe('String');
      expect(columnMap['status']).toMatch(/Enum8/);
      expect(columnMap['expires_at']).toMatch(/Nullable\(DateTime64/);
      expect(columnMap['last_used_at']).toMatch(/Nullable\(DateTime64/);
      expect(columnMap['failed_attempts_count']).toBe('UInt8');
      expect(columnMap['last_failed_attempt_at']).toMatch(
        /Nullable\(DateTime64/,
      );
      expect(columnMap['created_by']).toBe('String');
      expect(columnMap['revoked_by']).toMatch(/Nullable\(String\)/);
      expect(columnMap['revoked_at']).toMatch(/Nullable\(DateTime64/);
      expect(columnMap['created_at']).toMatch(/DateTime64/);
      expect(columnMap['updated_at']).toMatch(/DateTime64/);
    });
  });
});
