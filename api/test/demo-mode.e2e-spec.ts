// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();
// Enable demo mode for this test suite
process.env.IS_DEMO = 'true';

import request from 'supertest';
import {
  createTestAppWithWorkspace,
  closeTestApp,
  TestAppContext,
} from './helpers/app.helper';
import { createUserWithToken } from './helpers/user.helper';
import { truncateSystemTables } from './helpers/cleanup.helper';
import { toClickHouseDateTime } from './helpers';
import { waitForClickHouse } from './helpers/wait.helper';

describe('Demo Mode Restrictions', () => {
  let ctx: TestAppContext;
  let authToken: string;
  const testWorkspaceId = 'demo_test_ws';

  beforeAll(async () => {
    ctx = await createTestAppWithWorkspace();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    // Clean system tables before each test
    await truncateSystemTables(ctx.systemClient, [
      'workspaces',
      'workspace_memberships',
      'invitations',
      'users',
      'sessions',
      'api_keys',
    ]);

    // Create test user with super admin privileges
    const { token } = await createUserWithToken(
      ctx.app,
      ctx.systemClient,
      'demo-test@test.com',
      undefined,
      { name: 'Demo Test User', isSuperAdmin: true },
    );
    authToken = token;

    // Create a test workspace for endpoints that require one
    await ctx.systemClient.insert({
      table: 'workspaces',
      values: [
        {
          id: testWorkspaceId,
          name: 'Demo Test Workspace',
          website: 'https://demo-test.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          settings: JSON.stringify({
            timescore_reference: 60,
            bounce_threshold: 10,
          }),
          created_at: toClickHouseDateTime(),
          updated_at: toClickHouseDateTime(),
        },
      ],
      format: 'JSONEachRow',
    });

    // Add user as owner of the workspace
    const userResult = await ctx.systemClient.query({
      query: "SELECT id FROM users WHERE email = 'demo-test@test.com' LIMIT 1",
      format: 'JSONEachRow',
    });
    const users = (await userResult.json()) as { id: string }[];
    if (users.length > 0) {
      await ctx.systemClient.insert({
        table: 'workspace_memberships',
        values: [
          {
            id: 'membership_1',
            workspace_id: testWorkspaceId,
            user_id: users[0].id,
            role: 'owner',
            invited_by: null,
            joined_at: toClickHouseDateTime(),
            created_at: toClickHouseDateTime(),
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
    }

    await waitForClickHouse();
  });

  describe('Workspace endpoints', () => {
    it('blocks workspaces.create in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/workspaces.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          id: 'new_ws',
          name: 'New Workspace',
          website: 'https://new.com',
          timezone: 'UTC',
          currency: 'USD',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks workspaces.update in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/workspaces.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          id: testWorkspaceId,
          name: 'Updated Name',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks workspaces.delete in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/workspaces.delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: testWorkspaceId })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('allows workspaces.list in demo mode (read-only)', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/workspaces.list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });

    it('allows workspaces.get in demo mode (read-only)', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/workspaces.get')
        .query({ id: testWorkspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });

  describe('API Keys endpoints', () => {
    it('blocks apiKeys.create in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          name: 'Test API Key',
          scopes: ['events.track'],
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks apiKeys.revoke in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/apiKeys.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          id: 'some_key_id',
          revoked_by: 'user_id',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });
  });

  describe('User profile endpoints', () => {
    it('blocks auth.updateProfile in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/auth.updateProfile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Name' })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks auth.changePassword in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/auth.changePassword')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'oldpass',
          newPassword: 'newpass',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('allows auth.me in demo mode (read-only)', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/auth.me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });

  describe('Members endpoints', () => {
    it('blocks members.updateRole in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: 'some_user',
          role: 'editor',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks members.remove in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: 'some_user',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks members.leave in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.leave')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks members.transferOwnership in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: 'some_user',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });
  });

  describe('Invitations endpoints', () => {
    it('blocks invitations.create in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          email: 'invite@test.com',
          role: 'editor',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks invitations.resend in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/invitations.resend')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'some_invitation_id' })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks invitations.revoke in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/invitations.revoke')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'some_invitation_id' })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });
  });

  describe('SMTP endpoints', () => {
    it('blocks smtp.update in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/smtp.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          host: 'smtp.test.com',
          port: 587,
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks smtp.delete in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/smtp.delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: testWorkspaceId })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks smtp.test in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/smtp.test')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          to_email: 'test@test.com',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });
  });

  describe('Filters endpoints', () => {
    it('blocks filters.create in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          name: 'Test Filter',
          field: 'path',
          operator: 'equals',
          value: '/test',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks filters.update in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          id: 'some_filter_id',
          name: 'Updated Filter',
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks filters.delete in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.delete')
        .query({ workspace_id: testWorkspaceId, id: 'some_filter_id' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });

    it('blocks filters.reorder in demo mode', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/filters.reorder')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: testWorkspaceId,
          filter_ids: ['id1', 'id2'],
        })
        .expect(400);

      expect(response.body.message).toBe('This feature is disabled in demo');
    });
  });
});
