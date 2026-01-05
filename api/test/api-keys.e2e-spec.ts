// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv, TEST_SYSTEM_DATABASE } from './constants/test-config';
setupTestEnv();

import request from 'supertest';
import { createTestApp, closeTestApp, TestAppContext } from './helpers/app.helper';
import { toClickHouseDateTime } from './helpers';
import { createUserWithToken, createMembership } from './helpers/user.helper';
import { createTestWorkspace } from './helpers/workspace.helper';
import { truncateSystemTables } from './helpers/cleanup.helper';
import { waitForClickHouse, waitForMutations } from './helpers/wait.helper';

describe('API Keys Integration', () => {
  let ctx: TestAppContext;
  let authToken: string;
  let authUserId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    // Create test user for this test suite (uses default TEST_PASSWORD)
    const { id, token } = await createUserWithToken(
      ctx.app,
      ctx.systemClient,
      'apikeys-test@test.com',
      undefined,
      { name: 'API Keys Test User', isSuperAdmin: true },
    );
    authToken = token;
    authUserId = id;

    // Create test workspaces used by the tests
    const workspaceIds = [
      'test_ws_1', 'test_ws_2', 'test_ws_3', 'test_ws_4', 'test_ws_5', 'test_ws_6', 'test_ws_7',
      'test_ws_frontend', 'test_ws_expired',
      'workspace_1', 'workspace_2', 'workspace_get_test', 'workspace_revoke_test',
      'workspace_exp', 'workspace_metadata',
    ];
    for (const wsId of workspaceIds) {
      await createTestWorkspace(ctx.systemClient, wsId);
      await createMembership(ctx.systemClient, wsId, id, 'owner');
    }
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    // Clean api_keys table before each test
    await truncateSystemTables(ctx.systemClient, ['api_keys']);
  });

  describe('POST /api/apiKeys.create', () => {
    it('creates API key and returns full key only once', async () => {
      // Note: user_id is now taken from authenticated user (JWT), not from request body
      const dto = {
        workspace_id: 'test_ws_1',
        name: 'Test API Key',
        description: 'For testing purposes',
        scopes: ['analytics.view', 'analytics.export'],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Verify response structure
      expect(response.body.key).toBeDefined();
      expect(response.body.key).toMatch(/^stam_live_[a-f0-9]{64}$/);
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
      await waitForClickHouse();

      // Verify persisted in ClickHouse
      const result = await ctx.systemClient.query({
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
          'analytics.view',
          'analytics.export',
          'workspace.read',
          'workspace.manage',
        ],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.apiKey.scopes).toHaveLength(4);
      expect(response.body.apiKey.scopes).toEqual(
        expect.arrayContaining([
          'analytics.view',
          'analytics.export',
          'workspace.read',
          'workspace.manage',
        ]),
      );
    });

    it('creates API key with expiration date', async () => {
      const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      const dto = {
        workspace_id: 'test_ws_3',
        name: 'Temporary Key',
        scopes: ['analytics.export'],
        expires_at: expirationDate.toISOString(),
      };

      const response = await request(ctx.app.getHttpServer())
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
        // workspace_id omitted for user-level key
        name: 'User-level Key',
        scopes: ['analytics.export'],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400); // workspace_id is required in current implementation

      // Note: This test documents current behavior. To support user-level keys,
      // make workspace_id optional in CreateApiKeyDto
    });

    it('creates API key without optional description', async () => {
      const dto = {
        workspace_id: 'test_ws_4',
        name: 'No Description Key',
        scopes: ['analytics.view'],
      };

      const response = await request(ctx.app.getHttpServer())
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
        scopes: ['analytics.export'],
      };

      await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .send(dto)
        .expect(401);
    });

    it('rejects creation with missing required fields', async () => {
      const dto = {
        // missing name and scopes (user_id is optional - comes from JWT)
        workspace_id: 'test_ws_missing',
      };

      const response = await request(ctx.app.getHttpServer())
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

      await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);
    });

    it('rejects creation with name too long', async () => {
      const dto = {
        workspace_id: 'test_ws_7',
        name: 'A'.repeat(101), // Max length is 100
        scopes: ['analytics.export'],
      };

      await request(ctx.app.getHttpServer())
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
        scopes: ['analytics.export'],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      // Verify response structure
      expect(response.body.key).toBeDefined();
      expect(response.body.key).toMatch(/^stam_live_[a-f0-9]{64}$/);
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
          scopes: JSON.stringify(['analytics.export']),
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
          scopes: JSON.stringify(['analytics.view']),
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
          scopes: JSON.stringify(['workspace.read']),
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

      await ctx.systemClient.insert({
        table: 'api_keys',
        values: apiKeys,
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('returns all API keys for user without key_hash', async () => {
      const response = await request(ctx.app.getHttpServer())
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
      const response = await request(ctx.app.getHttpServer())
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
      const response = await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ status: 'revoked' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('key_3');
      expect(response.body[0].status).toBe('revoked');
    });

    it('filters API keys by active status', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ status: 'active' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((k: Record<string, unknown>) => k.status === 'active')).toBe(true);
    });

    it('combines multiple filters (user_id and workspace_id)', async () => {
      const response = await request(ctx.app.getHttpServer())
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
      const response = await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ user_id: 'nonexistent_user' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns all keys when no filters provided', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(3);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
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
        scopes: JSON.stringify(['analytics.export', 'workspace.read']),
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

      await ctx.systemClient.insert({
        table: 'api_keys',
        values: [apiKey],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('returns single API key by id', async () => {
      const response = await request(ctx.app.getHttpServer())
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
      expect(response.body.scopes).toEqual(['analytics.export', 'workspace.read']);
      expect(response.body.status).toBe('active');
    });

    it('returns 404 for non-existent API key', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.get')
        .query({ id: 'nonexistent_key_id' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
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
        scopes: JSON.stringify(['analytics.view']),
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

      await ctx.systemClient.insert({
        table: 'api_keys',
        values: [apiKey],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('marks API key as revoked', async () => {
      const dto = {
        id: testKeyId,
        revoked_by: 'admin_user',
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(200);

      expect(response.body.id).toBe(testKeyId);
      expect(response.body.status).toBe('revoked');
      expect(response.body.revoked_by).toBe('admin_user');
      expect(response.body.revoked_at).toBeDefined();

      // Wait for mutation to complete
      await waitForMutations(ctx.systemClient, TEST_SYSTEM_DATABASE);

      // Verify in database
      const result = await ctx.systemClient.query({
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

      await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(404);
    });

    it('can revoke already revoked key', async () => {
      // First revocation
      await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: testKeyId, revoked_by: 'first_admin' })
        .expect(200);

      await waitForMutations(ctx.systemClient, TEST_SYSTEM_DATABASE);

      // Second revocation (should succeed)
      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: testKeyId, revoked_by: 'second_admin' })
        .expect(200);

      expect(response.body.status).toBe('revoked');
      // Should update to new revoked_by
      expect(response.body.revoked_by).toBe('second_admin');
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
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
        scopes: ['analytics.export'],
        expires_at: pastDate.toISOString(),
      };

      const response = await request(ctx.app.getHttpServer())
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
        scopes: JSON.stringify(['analytics.export']),
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

      await ctx.systemClient.insert({
        table: 'api_keys',
        values: [expiredKey],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      const response = await request(ctx.app.getHttpServer())
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
        scopes: ['analytics.view', 'analytics.export'],
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      };

      const createResponse = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      const keyId = createResponse.body.apiKey.id;

      await waitForClickHouse();

      // Retrieve and verify all fields
      const getResponse = await request(ctx.app.getHttpServer())
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
      const result = await ctx.systemClient.query({
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
