// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import request from 'supertest';
import {
  createTestApp,
  closeTestApp,
  TestAppContext,
} from './helpers/app.helper';
import { toClickHouseDateTime } from './helpers';
import { createUserWithToken, createMembership } from './helpers/user.helper';
import { createTestWorkspace } from './helpers/workspace.helper';
import { truncateSystemTables } from './helpers/cleanup.helper';
import { waitForClickHouse } from './helpers/wait.helper';
import { MailService } from '../src/mail/mail.service';
import { JwtService } from '@nestjs/jwt';

describe('Subscriptions Integration', () => {
  let ctx: TestAppContext;
  let authToken: string;
  let authUserId: string;
  let mailService: MailService;
  let jwtService: JwtService;

  beforeAll(async () => {
    ctx = await createTestApp({ mockMailService: true });
    mailService = ctx.moduleFixture.get<MailService>(MailService);
    jwtService = ctx.moduleFixture.get<JwtService>(JwtService);

    // Mock sendReport method
    jest.spyOn(mailService, 'sendReport').mockResolvedValue();

    // Create test user for this test suite
    const { id, token } = await createUserWithToken(
      ctx.app,
      ctx.systemClient,
      'subscriptions-test@test.com',
      undefined,
      { name: 'Subscriptions Test User', isSuperAdmin: true },
    );
    authToken = token;
    authUserId = id;

    // Create test workspaces
    const workspaceIds = ['sub_ws_1', 'sub_ws_2'];
    for (const wsId of workspaceIds) {
      await createTestWorkspace(ctx.systemClient, wsId);
      await createMembership(ctx.systemClient, wsId, id, 'owner');
    }
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    // Clean report_subscriptions table before each test
    await truncateSystemTables(ctx.systemClient, ['report_subscriptions']);
    jest.clearAllMocks();
  });

  describe('POST /api/subscriptions.create', () => {
    it('creates subscription for authenticated user', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Daily Report',
        frequency: 'daily',
        hour: 8,
        metrics: ['sessions', 'median_duration'],
        dimensions: ['landing_path', 'device'],
        filters: [],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.user_id).toBe(authUserId);
      expect(response.body.workspace_id).toBe(dto.workspace_id);
      expect(response.body.name).toBe(dto.name);
      expect(response.body.frequency).toBe(dto.frequency);
      expect(response.body.status).toBe('active');
      expect(response.body.next_send_at).toBeDefined();
    });

    it('rejects without authentication', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Unauthorized Report',
        frequency: 'daily',
        metrics: ['sessions'],
      };

      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .send(dto)
        .expect(401);
    });

    it('validates required fields', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        // missing name, frequency, metrics
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('name'),
          expect.stringContaining('frequency'),
          expect.stringContaining('metrics'),
        ]),
      );
    });

    it('requires day_of_week for weekly subscriptions', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Weekly Report',
        frequency: 'weekly',
        metrics: ['sessions'],
        // missing day_of_week
      };

      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);
    });

    it('requires day_of_month for monthly subscriptions', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Monthly Report',
        frequency: 'monthly',
        metrics: ['sessions'],
        // missing day_of_month
      };

      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);
    });

    it('creates weekly subscription with day_of_week', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Weekly Report',
        frequency: 'weekly',
        day_of_week: 1, // Monday
        hour: 9,
        metrics: ['sessions', 'bounce_rate'],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.frequency).toBe('weekly');
      expect(response.body.day_of_week).toBe(1);
    });

    it('creates monthly subscription with day_of_month', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Monthly Report',
        frequency: 'monthly',
        day_of_month: 15,
        hour: 10,
        metrics: ['sessions'],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.frequency).toBe('monthly');
      expect(response.body.day_of_month).toBe(15);
    });
  });

  describe('GET /api/subscriptions.list', () => {
    beforeEach(async () => {
      // Insert test subscriptions
      const now = toClickHouseDateTime();
      const subscriptions = [
        {
          id: 'sub_1',
          user_id: authUserId,
          workspace_id: 'sub_ws_1',
          name: 'Daily Report 1',
          frequency: 'daily',
          day_of_week: null,
          day_of_month: null,
          hour: 8,
          metrics: ['sessions'],
          dimensions: [],
          filters: '[]',
          status: 'active',
          last_sent_at: null,
          last_send_status: 'pending',
          last_error: '',
          next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
          consecutive_failures: 0,
          created_at: toClickHouseDateTime(new Date(Date.now() - 3000)),
          updated_at: now,
        },
        {
          id: 'sub_2',
          user_id: authUserId,
          workspace_id: 'sub_ws_1',
          name: 'Weekly Report',
          frequency: 'weekly',
          day_of_week: 1,
          day_of_month: null,
          hour: 9,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['device'],
          filters: '[]',
          status: 'active',
          last_sent_at: null,
          last_send_status: 'pending',
          last_error: '',
          next_send_at: toClickHouseDateTime(
            new Date(Date.now() + 86400000 * 7),
          ),
          consecutive_failures: 0,
          created_at: toClickHouseDateTime(new Date(Date.now() - 2000)),
          updated_at: now,
        },
        {
          id: 'sub_3',
          user_id: 'other_user',
          workspace_id: 'sub_ws_1',
          name: 'Other User Report',
          frequency: 'daily',
          day_of_week: null,
          day_of_month: null,
          hour: 8,
          metrics: ['sessions'],
          dimensions: [],
          filters: '[]',
          status: 'active',
          last_sent_at: null,
          last_send_status: 'pending',
          last_error: '',
          next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
          consecutive_failures: 0,
          created_at: toClickHouseDateTime(new Date(Date.now() - 1000)),
          updated_at: now,
        },
      ];

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: subscriptions,
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('returns user subscriptions for workspace', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.list')
        .query({ workspace_id: 'sub_ws_1' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should only return subscriptions for the authenticated user
      expect(response.body).toHaveLength(2);
      expect(
        response.body.every(
          (s: { user_id: string }) => s.user_id === authUserId,
        ),
      ).toBe(true);
    });

    it('does not show other users subscriptions', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.list')
        .query({ workspace_id: 'sub_ws_1' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should not contain sub_3 which belongs to other_user
      expect(
        response.body.find((s: { id: string }) => s.id === 'sub_3'),
      ).toBeUndefined();
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.list')
        .query({ workspace_id: 'sub_ws_1' })
        .expect(401);
    });
  });

  describe('GET /api/subscriptions.get', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_get_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Get Test Subscription',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('returns single subscription by id', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.get')
        .query({ id: 'sub_get_test' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe('sub_get_test');
      expect(response.body.name).toBe('Get Test Subscription');
    });

    it('returns 400 for non-existent subscription', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.get')
        .query({ id: 'nonexistent' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('POST /api/subscriptions.update', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_update_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Update Test Subscription',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('updates subscription', async () => {
      const dto = {
        id: 'sub_update_test',
        workspace_id: 'sub_ws_1',
        name: 'Updated Name',
        hour: 10,
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.hour).toBe(10);
    });
  });

  describe('POST /api/subscriptions.pause', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_pause_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Pause Test Subscription',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('pauses subscription', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.pause')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'sub_pause_test', workspace_id: 'sub_ws_1' })
        .expect(201);

      expect(response.body.status).toBe('paused');
    });
  });

  describe('POST /api/subscriptions.resume', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_resume_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Resume Test Subscription',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'paused',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: null,
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('resumes paused subscription', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.resume')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'sub_resume_test', workspace_id: 'sub_ws_1' })
        .expect(201);

      expect(response.body.status).toBe('active');
      expect(response.body.next_send_at).toBeDefined();
    });
  });

  describe('POST /api/subscriptions.delete', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_delete_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Delete Test Subscription',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('deletes subscription (soft delete)', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.delete')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'sub_delete_test', workspace_id: 'sub_ws_1' })
        .expect(201);

      expect(response.body.success).toBe(true);

      // Verify subscription is no longer returned in list
      const listResponse = await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.list')
        .query({ workspace_id: 'sub_ws_1' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(
        listResponse.body.find(
          (s: { id: string }) => s.id === 'sub_delete_test',
        ),
      ).toBeUndefined();
    });
  });

  describe('POST /api/subscriptions.sendNow', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_sendnow_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Send Now Test',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    // Note: This test is skipped because it requires a workspace database with analytics data
    // The report generator queries the workspace database which requires complex setup
    it.skip('sends report immediately', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.sendNow')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: 'sub_sendnow_test', workspace_id: 'sub_ws_1' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(mailService.sendReport).toHaveBeenCalled();
    });
  });

  describe('POST /api/subscriptions.preview', () => {
    it('validates required fields', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        // missing name, frequency, metrics
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('name'),
          expect.stringContaining('frequency'),
          expect.stringContaining('metrics'),
        ]),
      );
    });

    it('rejects without authentication', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Preview Test',
        frequency: 'daily',
        metrics: ['sessions'],
      };

      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.preview')
        .send(dto)
        .expect(401);
    });

    it('rejects for non-member workspace', async () => {
      // Create a non-member user
      const { token: nonMemberToken } = await createUserWithToken(
        ctx.app,
        ctx.systemClient,
        'preview-non-member@test.com',
        undefined,
        { name: 'Preview Non Member', isSuperAdmin: false },
      );

      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Preview Test',
        frequency: 'daily',
        metrics: ['sessions'],
      };

      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.preview')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send(dto)
        .expect(403);
    });

    // Note: This test is skipped because it requires a workspace database with analytics data
    // The report generator queries the workspace database which requires complex setup
    it.skip('returns HTML preview for valid request', async () => {
      const dto = {
        workspace_id: 'sub_ws_1',
        name: 'Preview Test Report',
        frequency: 'daily',
        metrics: ['sessions', 'median_duration'],
        dimensions: ['landing_path'],
        limit: 10,
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.html).toBeDefined();
      expect(response.body.html).toContain('<!doctype html>');
    });
  });

  describe('GET /api/subscriptions.unsubscribe', () => {
    beforeEach(async () => {
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_unsub_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Unsubscribe Test',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('pauses subscription with valid token', async () => {
      const token = jwtService.sign({
        sub: 'sub_unsub_test',
        action: 'unsubscribe',
      });

      const response = await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.unsubscribe')
        .query({ token })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Successfully unsubscribed');
    });

    it('rejects invalid token', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.unsubscribe')
        .query({ token: 'invalid-token' })
        .expect(401);
    });

    it('rejects token with wrong action', async () => {
      const token = jwtService.sign({
        sub: 'sub_unsub_test',
        action: 'wrong_action',
      });

      await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.unsubscribe')
        .query({ token })
        .expect(400);
    });
  });

  describe('Workspace Access Control', () => {
    let nonMemberToken: string;
    let nonMemberUserId: string;

    beforeAll(async () => {
      // Create a non-super-admin user who is NOT a member of sub_ws_1 or sub_ws_2
      const { id, token } = await createUserWithToken(
        ctx.app,
        ctx.systemClient,
        'non-member@test.com',
        undefined,
        { name: 'Non Member User', isSuperAdmin: false },
      );
      nonMemberToken = token;
      nonMemberUserId = id;

      // Create a workspace that this user IS a member of
      await createTestWorkspace(ctx.systemClient, 'non_member_ws');
      await createMembership(ctx.systemClient, 'non_member_ws', id, 'owner');
    });

    beforeEach(async () => {
      // Insert a subscription in sub_ws_1 (owned by authUserId)
      const now = toClickHouseDateTime();
      const subscription = {
        id: 'sub_access_test',
        user_id: authUserId,
        workspace_id: 'sub_ws_1',
        name: 'Access Test Subscription',
        frequency: 'daily',
        day_of_week: null,
        day_of_month: null,
        hour: 8,
        metrics: ['sessions'],
        dimensions: [],
        filters: '[]',
        status: 'active',
        last_sent_at: null,
        last_send_status: 'pending',
        last_error: '',
        next_send_at: toClickHouseDateTime(new Date(Date.now() + 86400000)),
        consecutive_failures: 0,
        created_at: now,
        updated_at: now,
      };

      await ctx.systemClient.insert({
        table: 'report_subscriptions',
        values: [subscription],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('should return 403 when creating subscription for non-member workspace', async () => {
      const dto = {
        workspace_id: 'sub_ws_1', // non-member user is NOT a member of this workspace
        name: 'Unauthorized Report',
        frequency: 'daily',
        metrics: ['sessions'],
      };

      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send(dto)
        .expect(403);
    });

    it('should return 403 when listing subscriptions for non-member workspace', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.list')
        .query({ workspace_id: 'sub_ws_1' })
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .expect(403);
    });

    it('should return 403 when pausing subscription in non-member workspace', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.pause')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send({ id: 'sub_access_test', workspace_id: 'sub_ws_1' })
        .expect(403);
    });

    it('should return 403 when resuming subscription in non-member workspace', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.resume')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send({ id: 'sub_access_test', workspace_id: 'sub_ws_1' })
        .expect(403);
    });

    it('should return 403 when deleting subscription in non-member workspace', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.delete')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send({ id: 'sub_access_test', workspace_id: 'sub_ws_1' })
        .expect(403);
    });

    it('should return 403 when sending now for subscription in non-member workspace', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.sendNow')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send({ id: 'sub_access_test', workspace_id: 'sub_ws_1' })
        .expect(403);
    });

    it('should allow create for workspace members', async () => {
      const dto = {
        workspace_id: 'non_member_ws', // non-member user IS a member of this workspace
        name: 'Authorized Report',
        frequency: 'daily',
        metrics: ['sessions'],
      };

      const response = await request(ctx.app.getHttpServer())
        .post('/api/subscriptions.create')
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.user_id).toBe(nonMemberUserId);
    });

    it('should allow list for workspace members', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/subscriptions.list')
        .query({ workspace_id: 'non_member_ws' })
        .set('Authorization', `Bearer ${nonMemberToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
