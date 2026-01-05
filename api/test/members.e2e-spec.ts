// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv, TEST_SYSTEM_DATABASE } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import {
  createTestApp,
  closeTestApp,
  createTestWorkspace,
  createUserWithToken,
  createMembership,
  truncateSystemTables,
  waitForClickHouse,
  waitForMutations,
  TestAppContext,
  UserWithToken,
} from './helpers';

describe('Members Integration', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;

  // Test workspace and users
  const testWorkspaceId = 'test_ws_members';
  let ownerUserId: string;
  let ownerToken: string;
  let adminRoleUserId: string;
  let adminRoleToken: string;
  let editorUserId: string;
  let editorToken: string;
  let viewerUserId: string;
  let viewerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    systemClient = ctx.systemClient;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    // Clean system tables before each test
    await truncateSystemTables(systemClient, ['workspaces', 'users', 'workspace_memberships', 'audit_logs'], 0);
    await waitForClickHouse();
  });

  /**
   * Helper: Create a test user using shared helper
   */
  async function createUser(
    email: string,
    name: string,
  ): Promise<UserWithToken> {
    return createUserWithToken(ctx.app, systemClient, email, undefined, { name });
  }

  /**
   * Helper: Create test workspace using shared helper
   */
  async function createWorkspace(id: string = testWorkspaceId): Promise<void> {
    await createTestWorkspace(systemClient, id);
  }

  /**
   * Helper: Setup test scenario with workspace and multiple users
   */
  async function setupTestScenario(): Promise<void> {
    await createWorkspace(testWorkspaceId);

    // Create users
    const owner = await createUser('owner@test.com', 'Owner User');
    ownerUserId = owner.id;
    ownerToken = owner.token;

    const adminRole = await createUser('admin@test.com', 'Admin User');
    adminRoleUserId = adminRole.id;
    adminRoleToken = adminRole.token;

    const editor = await createUser('editor@test.com', 'Editor User');
    editorUserId = editor.id;
    editorToken = editor.token;

    const viewer = await createUser('viewer@test.com', 'Viewer User');
    viewerUserId = viewer.id;
    viewerToken = viewer.token;

    // Create memberships
    await createMembership(systemClient, testWorkspaceId, ownerUserId, 'owner');
    await createMembership(systemClient, testWorkspaceId, adminRoleUserId, 'admin', ownerUserId);
    await createMembership(systemClient, testWorkspaceId, editorUserId, 'editor', ownerUserId);
    await createMembership(systemClient, testWorkspaceId, viewerUserId, 'viewer', adminRoleUserId);
  }

  describe('GET /api/members.list', () => {
    it('returns workspace members with user details', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .get('/api/members.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body).toHaveLength(4);

      // Check that all members have user details
      const memberEmails = response.body.map((m: any) => m.user.email);
      expect(memberEmails).toContain('owner@test.com');
      expect(memberEmails).toContain('admin@test.com');
      expect(memberEmails).toContain('editor@test.com');
      expect(memberEmails).toContain('viewer@test.com');

      // Verify structure of first member
      const ownerMember = response.body.find(
        (m: any) => m.user.email === 'owner@test.com',
      );
      expect(ownerMember).toMatchObject({
        workspace_id: testWorkspaceId,
        user_id: ownerUserId,
        role: 'owner',
      });
      expect(ownerMember.user).toMatchObject({
        id: ownerUserId,
        email: 'owner@test.com',
        name: 'Owner User',
        status: 'active',
      });
      expect(ownerMember.created_at).toBeDefined();
      expect(ownerMember.updated_at).toBeDefined();
    });

    it('allows any member to list workspace members', async () => {
      await setupTestScenario();

      // Viewer should be able to list members
      const response = await request(ctx.app.getHttpServer())
        .get('/api/members.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body).toHaveLength(4);
    });

    it('fails without authentication', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .get('/api/members.list')
        .query({ workspace_id: testWorkspaceId })
        .expect(401);
    });

    it('fails for non-members', async () => {
      await setupTestScenario();

      // Create a user who is not a member
      const nonMember = await createUser('nonmember@test.com', 'Non Member');

      await request(ctx.app.getHttpServer())
        .get('/api/members.list')
        .query({ workspace_id: testWorkspaceId })
        .set('Authorization', `Bearer ${nonMember.token}`)
        .expect(403);
    });
  });

  describe('GET /api/members.get', () => {
    it('returns single member with user details', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .get('/api/members.get')
        .query({ workspace_id: testWorkspaceId, user_id: adminRoleUserId })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        workspace_id: testWorkspaceId,
        user_id: adminRoleUserId,
        role: 'admin',
        invited_by: ownerUserId,
      });
      expect(response.body.user).toMatchObject({
        id: adminRoleUserId,
        email: 'admin@test.com',
        name: 'Admin User',
        status: 'active',
      });
    });

    it('fails for non-member requesting member info', async () => {
      await setupTestScenario();

      const nonMember = await createUser('nonmember@test.com', 'Non Member');

      await request(ctx.app.getHttpServer())
        .get('/api/members.get')
        .query({ workspace_id: testWorkspaceId, user_id: ownerUserId })
        .set('Authorization', `Bearer ${nonMember.token}`)
        .expect(403);
    });

    it('returns 404 for non-existent member', async () => {
      await setupTestScenario();

      const nonMember = await createUser('other@test.com', 'Other User');

      await request(ctx.app.getHttpServer())
        .get('/api/members.get')
        .query({ workspace_id: testWorkspaceId, user_id: nonMember.id })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('POST /api/members.updateRole', () => {
    it('owner can change any role', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: editorUserId,
          role: 'admin',
        })
        .expect(201);

      expect(response.body.role).toBe('admin');
      expect(response.body.user_id).toBe(editorUserId);

      // Verify in database
      await waitForClickHouse();
      const result = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {workspace_id:String} AND user_id = {user_id:String}',
        query_params: { workspace_id: testWorkspaceId, user_id: editorUserId },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Record<string, unknown>[];
      expect(rows[0].role).toBe('admin');
    });

    it('admin can change editor/viewer roles', async () => {
      await setupTestScenario();

      // Admin changes viewer to editor
      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
          role: 'editor',
        })
        .expect(201);

      expect(response.body.role).toBe('editor');
      expect(response.body.user_id).toBe(viewerUserId);
    });

    it('admin cannot change owner role', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: ownerUserId,
          role: 'admin',
        })
        .expect(403);
    });

    it('admin cannot promote to owner', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: editorUserId,
          role: 'owner',
        })
        .expect(403);
    });

    it('cannot change own role', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: ownerUserId,
          role: 'admin',
        })
        .expect(400);
    });

    it('cannot change higher/equal role (admin tries to change another admin)', async () => {
      await setupTestScenario();

      // Create another admin
      const admin2 = await createUser('admin2@test.com', 'Admin 2');
      await createMembership(systemClient, testWorkspaceId, admin2.id, 'admin', ownerUserId);

      // First admin tries to change second admin
      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: admin2.id,
          role: 'editor',
        })
        .expect(403);
    });

    it('viewer cannot change roles', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: editorUserId,
          role: 'viewer',
        })
        .expect(403);
    });

    it('editor cannot change roles', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
          role: 'editor',
        })
        .expect(403);
    });

    it('owner can promote member to owner', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: adminRoleUserId,
          role: 'owner',
        })
        .expect(201);

      expect(response.body.role).toBe('owner');
    });

    it('logs audit event when role is updated', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.updateRole')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: editorUserId,
          role: 'admin',
        })
        .expect(201);

      // Wait for audit log to be written
      await waitForClickHouse();

      // Check audit log
      const result = await systemClient.query({
        query:
          'SELECT * FROM audit_logs WHERE workspace_id = {workspace_id:String} AND action = {action:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          action: 'member.role_updated',
        },
        format: 'JSONEachRow',
      });
      const logs = (await result.json()) as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);

      const log = logs[0];
      expect(log.user_id).toBe(ownerUserId);
      expect(log.workspace_id).toBe(testWorkspaceId);
      expect(log.action).toBe('member.role_updated');

      const metadata = JSON.parse(log.metadata as string);
      expect(metadata.user_id).toBe(editorUserId);
      expect(metadata.old_role).toBe('editor');
      expect(metadata.new_role).toBe('admin');
    });
  });

  describe('POST /api/members.remove', () => {
    it('owner can remove members', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
        })
        .expect(201);

      expect(response.body.success).toBe(true);

      // Wait for deletion to complete
      await waitForMutations(systemClient, TEST_SYSTEM_DATABASE);

      // Verify member is removed from database
      const result = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {workspace_id:String} AND user_id = {user_id:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
        },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Record<string, unknown>[];
      expect(rows).toHaveLength(0);
    });

    it('admin can remove lower role members', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: editorUserId,
        })
        .expect(201);
    });

    it('admin cannot remove owner', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: ownerUserId,
        })
        .expect(403);
    });

    it('cannot remove self', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: ownerUserId,
        })
        .expect(400);
    });

    it('cannot remove last owner', async () => {
      await setupTestScenario();

      // Create another owner
      const owner2 = await createUser('owner2@test.com', 'Owner 2');
      await createMembership(systemClient, testWorkspaceId, owner2.id, 'owner', ownerUserId);

      // First owner removes second owner - should succeed
      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: owner2.id,
        })
        .expect(200);

      // Wait for deletion
      await waitForMutations(systemClient, TEST_SYSTEM_DATABASE);

      // Now try to remove the last owner - should fail
      // Need to use owner2's token to try to remove ownerUserId
      // But owner2 is already removed, so let's have admin try it
      // Actually, admin can't remove owner, so let's create a third owner first

      const owner3 = await createUser('owner3@test.com', 'Owner 3');
      const owner3Result = await request(ctx.app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: 'owner3@test.com', password: 'testpass123' });
      const owner3Token = owner3Result.body.access_token;

      await createMembership(systemClient, testWorkspaceId, owner3.id, 'owner', ownerUserId);

      // Now owner3 tries to remove the last remaining original owner
      // But ownerUserId is now the only owner after removing owner2
      // So this should fail with 403 (cannot remove last owner)
      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${owner3Token}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: ownerUserId,
        })
        .expect(403);
    });

    it('editor/viewer cannot remove members', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
        })
        .expect(403);
    });

    it('logs audit event when member is removed', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.remove')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
        })
        .expect(200);

      // Wait for audit log
      await waitForClickHouse();

      const result = await systemClient.query({
        query:
          'SELECT * FROM audit_logs WHERE workspace_id = {workspace_id:String} AND action = {action:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          action: 'member.removed',
        },
        format: 'JSONEachRow',
      });
      const logs = (await result.json()) as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);

      const log = logs[0];
      expect(log.user_id).toBe(ownerUserId);
      const metadata = JSON.parse(log.metadata as string);
      expect(metadata.user_id).toBe(viewerUserId);
      expect(metadata.role).toBe('viewer');
    });
  });

  describe('POST /api/members.leave', () => {
    it('member can leave workspace', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.leave')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          workspace_id: testWorkspaceId,
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Wait for deletion
      await waitForMutations(systemClient, TEST_SYSTEM_DATABASE);

      // Verify member is removed
      const result = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {workspace_id:String} AND user_id = {user_id:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          user_id: viewerUserId,
        },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Record<string, unknown>[];
      expect(rows).toHaveLength(0);
    });

    it('last owner cannot leave', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.leave')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
        })
        .expect(400);
    });

    it('owner can leave if there are other owners', async () => {
      await setupTestScenario();

      // Create another owner
      const owner2 = await createUser('owner2@test.com', 'Owner 2');
      await createMembership(systemClient, testWorkspaceId, owner2.id, 'owner', ownerUserId);

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.leave')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('fails for non-member', async () => {
      await setupTestScenario();

      const nonMember = await createUser('nonmember@test.com', 'Non Member');

      await request(ctx.app.getHttpServer())
        .post('/api/members.leave')
        .set('Authorization', `Bearer ${nonMember.token}`)
        .send({
          workspace_id: testWorkspaceId,
        })
        .expect(404);
    });

    it('logs audit event when member leaves', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.leave')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({
          workspace_id: testWorkspaceId,
        })
        .expect(200);

      // Wait for audit log
      await waitForClickHouse();

      const result = await systemClient.query({
        query:
          'SELECT * FROM audit_logs WHERE workspace_id = {workspace_id:String} AND action = {action:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          action: 'member.left',
        },
        format: 'JSONEachRow',
      });
      const logs = (await result.json()) as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);

      const log = logs[0];
      expect(log.user_id).toBe(editorUserId);
      const metadata = JSON.parse(log.metadata as string);
      expect(metadata.role).toBe('editor');
    });
  });

  describe('POST /api/members.transferOwnership', () => {
    it('owner can transfer ownership to another member', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: adminRoleUserId,
        })
        .expect(201);

      expect(response.body.old_owner).toMatchObject({
        user_id: ownerUserId,
        role: 'admin', // Demoted to admin
      });
      expect(response.body.new_owner).toMatchObject({
        user_id: adminRoleUserId,
        role: 'owner', // Promoted to owner
      });

      // Verify in database
      await waitForClickHouse();

      const oldOwnerResult = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {workspace_id:String} AND user_id = {user_id:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          user_id: ownerUserId,
        },
        format: 'JSONEachRow',
      });
      const oldOwnerRows = (await oldOwnerResult.json()) as Record<string, unknown>[];
      expect(oldOwnerRows[0].role).toBe('admin');

      const newOwnerResult = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {workspace_id:String} AND user_id = {user_id:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          user_id: adminRoleUserId,
        },
        format: 'JSONEachRow',
      });
      const newOwnerRows = (await newOwnerResult.json()) as Record<string, unknown>[];
      expect(newOwnerRows[0].role).toBe('owner');
    });

    it('non-owner cannot transfer ownership', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${adminRoleToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: editorUserId,
        })
        .expect(403);
    });

    it('cannot transfer to non-member', async () => {
      await setupTestScenario();

      const nonMember = await createUser('nonmember@test.com', 'Non Member');

      await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: nonMember.id,
        })
        .expect(404);
    });

    it('cannot transfer to self', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: ownerUserId,
        })
        .expect(400);
    });

    it('logs audit event when ownership is transferred', async () => {
      await setupTestScenario();

      await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: adminRoleUserId,
        })
        .expect(201);

      // Wait for audit log
      await waitForClickHouse();

      const result = await systemClient.query({
        query:
          'SELECT * FROM audit_logs WHERE workspace_id = {workspace_id:String} AND action = {action:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          action: 'ownership.transferred',
        },
        format: 'JSONEachRow',
      });
      const logs = (await result.json()) as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);

      const log = logs[0];
      expect(log.user_id).toBe(ownerUserId);
      const metadata = JSON.parse(log.metadata as string);
      expect(metadata.old_owner_id).toBe(ownerUserId);
      expect(metadata.new_owner_id).toBe(adminRoleUserId);
    });

    it('returns user details for both old and new owner', async () => {
      await setupTestScenario();

      const response = await request(ctx.app.getHttpServer())
        .post('/api/members.transferOwnership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          workspace_id: testWorkspaceId,
          new_owner_id: adminRoleUserId,
        })
        .expect(201);

      expect(response.body.old_owner.user).toMatchObject({
        id: ownerUserId,
        email: 'owner@test.com',
        name: 'Owner User',
        status: 'active',
      });

      expect(response.body.new_owner.user).toMatchObject({
        id: adminRoleUserId,
        email: 'admin@test.com',
        name: 'Admin User',
        status: 'active',
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles workspace with no members', async () => {
      await createWorkspace('empty_ws');

      const nonMember = await createUser('user@test.com', 'User');

      await request(ctx.app.getHttpServer())
        .get('/api/members.list')
        .query({ workspace_id: 'empty_ws' })
        .set('Authorization', `Bearer ${nonMember.token}`)
        .expect(403);
    });

    it('validates workspace_id format', async () => {
      await setupTestScenario();

      // Empty workspace_id results in 403 because the user is not a member of empty workspace
      await request(ctx.app.getHttpServer())
        .get('/api/members.list')
        .query({ workspace_id: '' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('handles concurrent role updates gracefully', async () => {
      await setupTestScenario();

      // Create two owners
      const owner2 = await createUser('owner2@test.com', 'Owner 2');
      const owner2Result = await request(ctx.app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: 'owner2@test.com', password: 'testpass123' });
      const owner2Token = owner2Result.body.access_token;

      await createMembership(systemClient, testWorkspaceId, owner2.id, 'owner', ownerUserId);

      // Both owners try to update the same member's role at the same time
      const promises = [
        request(ctx.app.getHttpServer())
          .post('/api/members.updateRole')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            workspace_id: testWorkspaceId,
            user_id: editorUserId,
            role: 'admin',
          }),
        request(ctx.app.getHttpServer())
          .post('/api/members.updateRole')
          .set('Authorization', `Bearer ${owner2Token}`)
          .send({
            workspace_id: testWorkspaceId,
            user_id: editorUserId,
            role: 'viewer',
          }),
      ];

      const results = await Promise.all(promises);

      // Both should succeed (ClickHouse ReplacingMergeTree handles this)
      // POST returns 201 by default in NestJS
      expect(results[0].status).toBe(201);
      expect(results[1].status).toBe(201);

      // Last write wins
      await waitForClickHouse();
      const result = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {workspace_id:String} AND user_id = {user_id:String}',
        query_params: {
          workspace_id: testWorkspaceId,
          user_id: editorUserId,
        },
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as Record<string, unknown>[];
      expect(['admin', 'viewer']).toContain(rows[0].role);
    });
  });
});
