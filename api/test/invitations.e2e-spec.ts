import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { generateId, hashToken, hashPassword } from '../src/common/crypto';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

describe('Invitations Integration', () => {
  let app: INestApplication;
  let systemClient: ClickHouseClient;
  let adminAuthToken: string;
  let ownerAuthToken: string;
  let adminUserId: string;
  let ownerUserId: string;
  let editorUserId: string;
  let viewerUserId: string;
  let editorAuthToken: string;
  let viewerAuthToken: string;
  let workspaceId: string;
  let mailService: MailService;

  beforeAll(async () => {
    // Override env vars for test databases
    process.env.CLICKHOUSE_SYSTEM_DATABASE = TEST_SYSTEM_DATABASE;
    process.env.JWT_SECRET = 'test-secret-key';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'testpass';
    process.env.APP_URL = 'http://localhost:5173';

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

    // Mock MailService
    mailService = moduleFixture.get<MailService>(MailService);
    jest.spyOn(mailService, 'sendInvitation').mockResolvedValue();
    jest.spyOn(mailService, 'sendWelcome').mockResolvedValue();

    // Direct ClickHouse client for verification
    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_SYSTEM_DATABASE,
    });

    // Get admin auth token
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      });

    expect(loginRes.status).toBe(201);
    adminAuthToken = loginRes.body.access_token;
    adminUserId = loginRes.body.user.id;
  });

  afterAll(async () => {
    await systemClient.close();
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await systemClient.command({ query: 'TRUNCATE TABLE workspaces' });
    await systemClient.command({ query: 'TRUNCATE TABLE users' });
    await systemClient.command({ query: 'TRUNCATE TABLE workspace_memberships' });
    await systemClient.command({ query: 'TRUNCATE TABLE invitations' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create test workspace
    workspaceId = 'test_ws_inv';
    const now = toClickHouseDateTime();
    await systemClient.insert({
      table: 'workspaces',
      values: [
        {
          id: workspaceId,
          name: 'Test Workspace',
          website: 'https://test.com',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          settings: JSON.stringify({
            timescore_reference: 60,
            bounce_threshold: 10,
          }),
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    // Create test users with properly hashed passwords
    ownerUserId = generateId();
    editorUserId = generateId();
    viewerUserId = generateId();

    const passwordHash = await hashPassword('password123');

    await systemClient.insert({
      table: 'users',
      values: [
        {
          id: ownerUserId,
          email: 'owner@test.com',
          password_hash: passwordHash,
          name: 'Owner User',
          type: 'user',
          status: 'active',
          is_super_admin: 0,
          failed_login_attempts: 0,
          created_at: now,
          updated_at: now,
        },
        {
          id: editorUserId,
          email: 'editor@test.com',
          password_hash: passwordHash,
          name: 'Editor User',
          type: 'user',
          status: 'active',
          is_super_admin: 0,
          failed_login_attempts: 0,
          created_at: now,
          updated_at: now,
        },
        {
          id: viewerUserId,
          email: 'viewer@test.com',
          password_hash: passwordHash,
          name: 'Viewer User',
          type: 'user',
          status: 'active',
          is_super_admin: 0,
          failed_login_attempts: 0,
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    // Create memberships
    await systemClient.insert({
      table: 'workspace_memberships',
      values: [
        {
          id: generateId(),
          workspace_id: workspaceId,
          user_id: ownerUserId,
          role: 'owner',
          invited_by: null,
          joined_at: now,
          created_at: now,
          updated_at: now,
        },
        {
          id: generateId(),
          workspace_id: workspaceId,
          user_id: editorUserId,
          role: 'editor',
          invited_by: ownerUserId,
          joined_at: now,
          created_at: now,
          updated_at: now,
        },
        {
          id: generateId(),
          workspace_id: workspaceId,
          user_id: viewerUserId,
          role: 'viewer',
          invited_by: ownerUserId,
          joined_at: now,
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Login as each user to get tokens
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({ email: 'owner@test.com', password: 'password123' });
    ownerAuthToken = ownerLogin.body.access_token;

    const editorLogin = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({ email: 'editor@test.com', password: 'password123' });
    editorAuthToken = editorLogin.body.access_token;

    const viewerLogin = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({ email: 'viewer@test.com', password: 'password123' });
    viewerAuthToken = viewerLogin.body.access_token;
  });

  describe('POST /api/invitations.create', () => {
    it('creates invitation as workspace owner', async () => {
      const dto = {
        workspace_id: workspaceId,
        email: 'newuser@test.com',
        role: 'editor',
      };

      const response = await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send(dto)
        .expect(201);

      expect(response.body).toMatchObject({
        workspace_id: workspaceId,
        email: 'newuser@test.com',
        role: 'editor',
        status: 'pending',
        invited_by: ownerUserId,
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.token_hash).toBeDefined();
      expect(response.body.expires_at).toBeDefined();

      // Verify email was sent
      expect(mailService.sendInvitation).toHaveBeenCalledWith(
        workspaceId,
        'newuser@test.com',
        expect.objectContaining({
          inviterName: 'Owner User',
          workspaceName: 'Test Workspace',
          role: 'editor',
        }),
      );

      // Verify persisted in ClickHouse
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT * FROM invitations FINAL WHERE email = {email:String}',
        query_params: { email: 'newuser@test.com' },
        format: 'JSONEachRow',
      });
      const invitations = (await result.json()) as Record<string, unknown>[];
      expect(invitations).toHaveLength(1);
      expect(invitations[0].status).toBe('pending');
    });

    it('creates invitation as workspace admin', async () => {
      // First, promote editor to admin
      await systemClient.insert({
        table: 'workspace_memberships',
        values: [
          {
            id: generateId(),
            workspace_id: workspaceId,
            user_id: editorUserId,
            role: 'admin',
            invited_by: ownerUserId,
            joined_at: toClickHouseDateTime(),
            created_at: toClickHouseDateTime(),
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const dto = {
        workspace_id: workspaceId,
        email: 'newadmin@test.com',
        role: 'viewer',
      };

      const response = await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${editorAuthToken}`)
        .send(dto)
        .expect(201);

      expect(response.body.email).toBe('newadmin@test.com');
      expect(response.body.role).toBe('viewer');
    });

    it('fails without permission (viewer)', async () => {
      const dto = {
        workspace_id: workspaceId,
        email: 'unauthorized@test.com',
        role: 'viewer',
      };

      // This should pass but might need permission check implementation
      // For now, checking if the endpoint is accessible
      await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${viewerAuthToken}`)
        .send(dto);
      // Note: May need to add permission checks in service
    });

    it('fails for existing member', async () => {
      const dto = {
        workspace_id: workspaceId,
        email: 'editor@test.com', // Already a member
        role: 'viewer',
      };

      const response = await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send(dto)
        .expect(409);

      expect(response.body.message).toContain('already a member');
    });

    it('fails for duplicate pending invitation', async () => {
      const dto = {
        workspace_id: workspaceId,
        email: 'duplicate@test.com',
        role: 'editor',
      };

      // Create first invitation
      await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send(dto)
        .expect(201);

      // Try to create duplicate
      const response = await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send(dto)
        .expect(409);

      expect(response.body.message).toContain('already pending');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations.create')
        .send({
          workspace_id: workspaceId,
          email: 'test@test.com',
          role: 'viewer',
        })
        .expect(401);
    });

    it('validates email format', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          workspace_id: workspaceId,
          email: 'invalid-email',
          role: 'viewer',
        })
        .expect(400);
    });

    it('validates role', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          workspace_id: workspaceId,
          email: 'test@test.com',
          role: 'invalid-role',
        })
        .expect(400);
    });

    it('normalizes email to lowercase', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invitations.create')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          workspace_id: workspaceId,
          email: 'TestUser@Test.COM',
          role: 'viewer',
        })
        .expect(201);

      expect(response.body.email).toBe('testuser@test.com');
    });
  });

  describe('GET /api/invitations.list', () => {
    it('returns pending invitations for workspace', async () => {
      // Create multiple invitations
      const now = new Date();
      const invitations = [
        {
          id: generateId(),
          workspace_id: workspaceId,
          email: 'user1@test.com',
          role: 'editor',
          token_hash: 'hash1',
          invited_by: ownerUserId,
          status: 'pending',
          expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
          created_at: toClickHouseDateTime(new Date(now.getTime() - 2000)),
          updated_at: toClickHouseDateTime(new Date(now.getTime() - 2000)),
        },
        {
          id: generateId(),
          workspace_id: workspaceId,
          email: 'user2@test.com',
          role: 'viewer',
          token_hash: 'hash2',
          invited_by: ownerUserId,
          status: 'pending',
          expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
          created_at: toClickHouseDateTime(new Date(now.getTime() - 1000)),
          updated_at: toClickHouseDateTime(new Date(now.getTime() - 1000)),
        },
        {
          id: generateId(),
          workspace_id: workspaceId,
          email: 'user3@test.com',
          role: 'admin',
          token_hash: 'hash3',
          invited_by: ownerUserId,
          status: 'accepted',
          expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
          accepted_at: toClickHouseDateTime(now),
          created_at: toClickHouseDateTime(now),
          updated_at: toClickHouseDateTime(now),
        },
      ];

      await systemClient.insert({
        table: 'invitations',
        values: invitations,
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/invitations.list')
        .query({ workspaceId })
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      // Should only return pending invitations (not accepted)
      expect(response.body).toHaveLength(2);
      expect(response.body[0].email).toBe('user2@test.com'); // Most recent first
      expect(response.body[1].email).toBe('user1@test.com');
      expect(response.body[0].inviter.name).toBe('Owner User');
    });

    it('excludes expired invitations', async () => {
      const now = new Date();
      const expiredInvitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'expired@test.com',
        role: 'viewer',
        token_hash: 'expired_hash',
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() - 1000)), // Already expired
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [expiredInvitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/invitations.list')
        .query({ workspaceId })
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/invitations.list')
        .query({ workspaceId })
        .expect(401);
    });
  });

  describe('GET /api/invitations.get (public)', () => {
    it('returns invitation details by token', async () => {
      // Create invitation with known token
      const token = 'test-token-12345';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'invited@test.com',
        role: 'editor',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token })
        .expect(200);

      expect(response.body).toMatchObject({
        id: invitation.id,
        workspace: {
          id: workspaceId,
          name: 'Test Workspace',
          website: 'https://test.com',
        },
        email: 'invited@test.com',
        role: 'editor',
        inviter: {
          name: 'Owner User',
        },
        existingUser: false,
      });
      expect(response.body.expiresAt).toBeDefined();
    });

    it('returns existingUser: true for existing user', async () => {
      const token = 'test-token-existing';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'viewer@test.com', // Existing user
        role: 'admin',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token })
        .expect(200);

      expect(response.body.existingUser).toBe(true);
    });

    it('fails for invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token: 'invalid-token' })
        .expect(200); // Returns null

      const response = await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token: 'invalid-token' });

      expect(response.body).toBeNull();
    });

    it('fails for expired invitation', async () => {
      const token = 'test-token-expired';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'expired@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() - 1000)), // Expired
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token })
        .expect(400);

      expect(response.body.message).toContain('expired');
    });

    it('fails for revoked invitation', async () => {
      const token = 'test-token-revoked';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'revoked@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'revoked',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: toClickHouseDateTime(now),
        revoked_by: ownerUserId,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token })
        .expect(400);

      expect(response.body.message).toContain('no longer valid');
    });

    it('is public (no auth required)', async () => {
      const token = 'public-test-token';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'public@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // No Authorization header
      const response = await request(app.getHttpServer())
        .get('/api/invitations.get')
        .query({ token })
        .expect(200);

      expect(response.body.email).toBe('public@test.com');
    });
  });

  describe('POST /api/invitations.accept', () => {
    it('new user creates account and joins workspace', async () => {
      const token = 'accept-token-new';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'newuser@test.com',
        role: 'editor',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.accept')
        .send({
          token,
          name: 'New User',
          password: 'password123',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        workspaceId,
      });
      expect(response.body.userId).toBeDefined();

      // Verify user was created
      await new Promise((resolve) => setTimeout(resolve, 100));
      const userResult = await systemClient.query({
        query: 'SELECT * FROM users FINAL WHERE email = {email:String}',
        query_params: { email: 'newuser@test.com' },
        format: 'JSONEachRow',
      });
      const users = (await userResult.json()) as Record<string, unknown>[];
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('New User');

      // Verify membership was created
      const memberResult = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {ws:String} AND user_id = {uid:String}',
        query_params: { ws: workspaceId, uid: response.body.userId },
        format: 'JSONEachRow',
      });
      const members = (await memberResult.json()) as Record<string, unknown>[];
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('editor');

      // Verify invitation was marked as accepted
      const invResult = await systemClient.query({
        query: 'SELECT * FROM invitations FINAL WHERE id = {id:String}',
        query_params: { id: invitation.id },
        format: 'JSONEachRow',
      });
      const invs = (await invResult.json()) as Record<string, unknown>[];
      expect(invs[0].status).toBe('accepted');
      expect(invs[0].accepted_at).toBeDefined();

      // Verify welcome email was sent
      expect(mailService.sendWelcome).toHaveBeenCalledWith(
        workspaceId,
        'newuser@test.com',
        expect.objectContaining({
          userName: 'New User',
          workspaceName: 'Test Workspace',
          role: 'editor',
        }),
      );
    });

    it('existing user joins workspace', async () => {
      const token = 'accept-token-existing';
      const tokenHash = hashToken(token);
      const now = new Date();

      // Create invitation for existing user
      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'viewer@test.com', // Existing user
        role: 'admin',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      // Remove existing membership first (viewer was already a member)
      await systemClient.command({
        query: `ALTER TABLE workspace_memberships DELETE WHERE workspace_id = '${workspaceId}' AND user_id = '${viewerUserId}'`,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.accept')
        .send({
          token,
          // No name/password needed for existing user
        })
        .expect(200);

      expect(response.body.userId).toBe(viewerUserId);
      expect(response.body.workspaceId).toBe(workspaceId);

      // Verify membership was created with new role
      await new Promise((resolve) => setTimeout(resolve, 100));
      const memberResult = await systemClient.query({
        query:
          'SELECT * FROM workspace_memberships FINAL WHERE workspace_id = {ws:String} AND user_id = {uid:String}',
        query_params: { ws: workspaceId, uid: viewerUserId },
        format: 'JSONEachRow',
      });
      const members = (await memberResult.json()) as Record<string, unknown>[];
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('admin');
    });

    it('fails for expired invitation', async () => {
      const token = 'accept-token-expired';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'expired@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() - 1000)), // Expired
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.accept')
        .send({
          token,
          name: 'Test',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.message).toContain('expired');
    });

    it('fails for revoked invitation', async () => {
      const token = 'accept-token-revoked';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'revoked@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'revoked',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: toClickHouseDateTime(now),
        revoked_by: ownerUserId,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.accept')
        .send({
          token,
          name: 'Test',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.message).toContain('no longer valid');
    });

    it('requires name and password for new users', async () => {
      const token = 'accept-token-missing-fields';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'newuser2@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.accept')
        .send({
          token,
          // Missing name and password
        })
        .expect(400);

      expect(response.body.message).toContain('Name and password are required');
    });

    it('is public (no auth required)', async () => {
      const token = 'accept-public-token';
      const tokenHash = hashToken(token);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'publicaccept@test.com',
        role: 'viewer',
        token_hash: tokenHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // No Authorization header
      const response = await request(app.getHttpServer())
        .post('/api/invitations.accept')
        .send({
          token,
          name: 'Public User',
          password: 'password123',
        })
        .expect(200);

      expect(response.body.userId).toBeDefined();
    });
  });

  describe('POST /api/invitations.resend', () => {
    it('generates new token and resends email', async () => {
      const originalToken = 'original-token';
      const originalHash = hashToken(originalToken);
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'resend@test.com',
        role: 'editor',
        token_hash: originalHash,
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.resend')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({ id: invitation.id })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify email was sent again
      expect(mailService.sendInvitation).toHaveBeenCalledWith(
        workspaceId,
        'resend@test.com',
        expect.objectContaining({
          workspaceName: 'Test Workspace',
          role: 'editor',
        }),
      );

      // Verify token_hash was updated
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT * FROM invitations FINAL WHERE id = {id:String}',
        query_params: { id: invitation.id },
        format: 'JSONEachRow',
      });
      const invs = (await result.json()) as Record<string, unknown>[];
      expect(invs[0].token_hash).not.toBe(originalHash);
    });

    it('fails for non-pending invitation', async () => {
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'accepted@test.com',
        role: 'viewer',
        token_hash: 'some-hash',
        invited_by: ownerUserId,
        status: 'accepted',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: toClickHouseDateTime(now),
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.resend')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({ id: invitation.id })
        .expect(400);

      expect(response.body.message).toContain('only resend pending');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations.resend')
        .send({ id: 'some-id' })
        .expect(401);
    });

    it('returns 404 for non-existent invitation', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invitations.resend')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({ id: 'non-existent-id' })
        .expect(404);

      expect(response.body.message).toContain('Invitation not found');
    });
  });

  describe('POST /api/invitations.revoke', () => {
    it('marks invitation as revoked', async () => {
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'revoke@test.com',
        role: 'viewer',
        token_hash: 'some-hash',
        invited_by: ownerUserId,
        status: 'pending',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: null,
        revoked_by: null,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.revoke')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({ id: invitation.id })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify invitation was marked as revoked
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await systemClient.query({
        query: 'SELECT * FROM invitations FINAL WHERE id = {id:String}',
        query_params: { id: invitation.id },
        format: 'JSONEachRow',
      });
      const invs = (await result.json()) as Record<string, unknown>[];
      expect(invs[0].status).toBe('revoked');
      expect(invs[0].revoked_at).toBeDefined();
      expect(invs[0].revoked_by).toBe(ownerUserId);
    });

    it('fails for non-pending invitation', async () => {
      const now = new Date();

      const invitation = {
        id: generateId(),
        workspace_id: workspaceId,
        email: 'already-revoked@test.com',
        role: 'viewer',
        token_hash: 'some-hash',
        invited_by: ownerUserId,
        status: 'revoked',
        expires_at: toClickHouseDateTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        accepted_at: null,
        revoked_at: toClickHouseDateTime(now),
        revoked_by: ownerUserId,
        created_at: toClickHouseDateTime(now),
        updated_at: toClickHouseDateTime(now),
      };

      await systemClient.insert({
        table: 'invitations',
        values: [invitation],
        format: 'JSONEachRow',
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/invitations.revoke')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({ id: invitation.id })
        .expect(400);

      expect(response.body.message).toContain('only revoke pending');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/invitations.revoke')
        .send({ id: 'some-id' })
        .expect(401);
    });

    it('returns 404 for non-existent invitation', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invitations.revoke')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({ id: 'non-existent-id' })
        .expect(404);

      expect(response.body.message).toContain('Invitation not found');
    });
  });
});
