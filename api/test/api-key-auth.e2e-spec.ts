// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import {
  createTestApp,
  closeTestApp,
  TestAppContext,
} from './helpers/app.helper';
import {
  createTestWorkspace,
  createTestApiKey,
} from './helpers/workspace.helper';
import { createUserWithToken, createMembership } from './helpers/user.helper';
import { truncateSystemTables } from './helpers/cleanup.helper';
import { waitForClickHouse } from './helpers/wait.helper';

const testWorkspaceId = 'api_key_auth_test_ws';
const otherWorkspaceId = 'api_key_auth_other_ws';

describe('API Key Authentication E2E', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let jwtToken: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ workspaceId: testWorkspaceId });
    systemClient = ctx.systemClient;

    // Create test user for JWT auth
    const { id, token } = await createUserWithToken(
      ctx.app,
      systemClient,
      'apikey-auth-test@test.com',
    );
    jwtToken = token;
    userId = id;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateSystemTables(systemClient, [
      'workspaces',
      'api_keys',
      'workspace_memberships',
    ]);

    // Create test workspaces
    await createTestWorkspace(systemClient, testWorkspaceId);
    await createTestWorkspace(systemClient, otherWorkspaceId);

    // Create membership for JWT user
    await createMembership(systemClient, testWorkspaceId, userId, 'owner');
    await createMembership(systemClient, otherWorkspaceId, userId, 'owner');

    await waitForClickHouse();
  });

  describe('Workspace-scoped endpoints', () => {
    describe('analytics.query', () => {
      it('allows API key on analytics.query for bound workspace', async () => {
        const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
          role: 'viewer',
        });

        const response = await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            workspace_id: testWorkspaceId,
            metrics: ['sessions'],
            dateRange: { preset: 'previous_30_days' },
          })
          .expect(200);

        expect(response.body).toBeDefined();
      });

      it('rejects API key on analytics.query for different workspace', async () => {
        const apiKey = await createTestApiKey(systemClient, otherWorkspaceId, {
          role: 'viewer',
        });

        await request(ctx.app.getHttpServer())
          .post('/api/analytics.query')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            workspace_id: testWorkspaceId,
            metrics: ['sessions'],
            dateRange: { preset: 'previous_30_days' },
          })
          .expect(403);
      });
    });

    describe('members.list', () => {
      it('allows API key on members.list for bound workspace', async () => {
        const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
          role: 'viewer',
        });

        await request(ctx.app.getHttpServer())
          .get('/api/members.list')
          .query({ workspace_id: testWorkspaceId })
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(200);
      });

      it('rejects API key on members.list for different workspace', async () => {
        const apiKey = await createTestApiKey(systemClient, otherWorkspaceId, {
          role: 'viewer',
        });

        await request(ctx.app.getHttpServer())
          .get('/api/members.list')
          .query({ workspace_id: testWorkspaceId })
          .set('Authorization', `Bearer ${apiKey}`)
          .expect(403);
      });
    });

    describe('User-specific actions (JWT only)', () => {
      it('rejects API key on members.leave', async () => {
        const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
          role: 'admin',
        });

        await request(ctx.app.getHttpServer())
          .post('/api/members.leave')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({ workspace_id: testWorkspaceId })
          .expect(401);
      });

      it('rejects API key on members.transferOwnership', async () => {
        const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
          role: 'admin',
        });

        await request(ctx.app.getHttpServer())
          .post('/api/members.transferOwnership')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({ workspace_id: testWorkspaceId, new_owner_id: 'some-user' })
          .expect(401);
      });
    });
  });

  describe('User-scoped endpoints (JWT only)', () => {
    it('rejects API key on auth.me', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId);

      await request(ctx.app.getHttpServer())
        .get('/api/auth.me')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401);
    });

    it('rejects API key on apiKeys.list', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId);

      await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401);
    });

    it('rejects API key on apiKeys.get', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId);

      await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.get')
        .query({ id: 'some-key-id' })
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401);
    });

    it('rejects API key on apiKeys.revoke', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId);

      await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ id: 'some-key-id' })
        .expect(401);
    });

    it('allows JWT on auth.me', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/auth.me')
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
    });

    it('allows JWT on apiKeys.list', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/apiKeys.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${jwtToken}`)
        .expect(200);
    });
  });

  describe('Role enforcement', () => {
    it('allows editor API key to create filter', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
        role: 'editor',
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.create')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          name: 'Test Filter',
          conditions: [
            { field: 'referrer', operator: 'contains', value: 'test' },
          ],
          operations: [
            { dimension: 'utm_source', action: 'set_value', value: 'api-test' },
          ],
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe('Test Filter');
    });

    it('rejects viewer API key from creating filter', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
        role: 'viewer',
      });

      await request(ctx.app.getHttpServer())
        .post('/api/filters.create')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          name: 'Test Filter',
          conditions: [
            { field: 'referrer', operator: 'contains', value: 'test' },
          ],
          operations: [
            { dimension: 'utm_source', action: 'set_value', value: 'api-test' },
          ],
        })
        .expect(403);
    });

    it('allows admin API key to update member role', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
        role: 'admin',
      });

      // Create another user to update
      const { id: targetUserId } = await createUserWithToken(
        ctx.app,
        systemClient,
        'target-user@test.com',
      );
      await createMembership(
        systemClient,
        testWorkspaceId,
        targetUserId,
        'viewer',
      );
      await waitForClickHouse();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: targetUserId,
          role: 'editor',
        })
        .expect(200);
    });

    it('rejects viewer API key from updating member role', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
        role: 'viewer',
      });

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: 'some-user',
          role: 'editor',
        })
        .expect(403);
    });
  });

  describe('Audit endpoints', () => {
    it('allows API key on audit.list for bound workspace', async () => {
      const apiKey = await createTestApiKey(systemClient, testWorkspaceId, {
        role: 'viewer',
      });

      await request(ctx.app.getHttpServer())
        .get('/api/audit.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
    });

    it('rejects API key on audit.list for different workspace', async () => {
      const apiKey = await createTestApiKey(systemClient, otherWorkspaceId, {
        role: 'viewer',
      });

      await request(ctx.app.getHttpServer())
        .get('/api/audit.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(403);
    });
  });
});
