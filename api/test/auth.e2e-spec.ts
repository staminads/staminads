import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { generateId, hashPassword } from '../src/common/crypto';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

describe('Auth Integration', () => {
  let app: INestApplication;
  let systemClient: ClickHouseClient;
  let mailService: MailService;

  // Helper: Create a test user directly in DB
  async function createTestUser(
    email: string,
    password: string,
    options: {
      status?: 'active' | 'pending' | 'disabled';
      failedAttempts?: number;
      lockedUntil?: string | null;
    } = {},
  ) {
    const passwordHash = await hashPassword(password);
    const now = toClickHouseDateTime();
    const userId = generateId();

    await systemClient.insert({
      table: 'users',
      values: [
        {
          id: userId,
          email: email.toLowerCase(),
          password_hash: passwordHash,
          name: 'Test User',
          type: 'user',
          status: options.status || 'active',
          is_super_admin: 0,
          last_login_at: null,
          failed_login_attempts: options.failedAttempts || 0,
          locked_until: options.lockedUntil || null,
          password_changed_at: now,
          deleted_at: null,
          deleted_by: null,
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    return userId;
  }

  // Helper: Get auth token for a user
  async function getAuthToken(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/auth.login')
      .send({ email, password });

    if (response.status !== 201) {
      throw new Error(`Login failed: ${response.body.message}`);
    }

    return response.body.access_token;
  }

  // Helper: Create a password reset token
  async function createPasswordResetToken(userId: string): Promise<string> {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    await systemClient.insert({
      table: 'password_reset_tokens',
      values: [
        {
          id: generateId(),
          user_id: userId,
          token_hash: tokenHash,
          status: 'pending',
          expires_at: toClickHouseDateTime(expiresAt),
          created_at: toClickHouseDateTime(now),
          updated_at: toClickHouseDateTime(now),
        },
      ],
      format: 'JSONEachRow',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    return token;
  }

  beforeAll(async () => {
    // Override env vars for test databases
    process.env.CLICKHOUSE_SYSTEM_DATABASE = TEST_SYSTEM_DATABASE;
    process.env.JWT_SECRET = 'test-secret-key';
    process.env.ADMIN_EMAIL = 'admin@test.com';
    process.env.ADMIN_PASSWORD = 'testpass';
    process.env.APP_URL = 'http://localhost:5173';
    // Disable mail sending for tests (missing SMTP config would cause errors)
    process.env.SMTP_HOST = '';

    // Create ClickHouse client first (before app init)
    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_SYSTEM_DATABASE,
    });

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

    mailService = moduleFixture.get<MailService>(MailService);

    // Create a test workspace for SMTP operations
    const now = toClickHouseDateTime();
    await systemClient.insert({
      table: 'workspaces',
      values: [
        {
          id: 'test_workspace',
          name: 'Test Workspace',
          website: 'https://test.com',
          timezone: 'UTC',
          currency: 'USD',
          logo_url: null,
          settings: '{}',
          status: 'active',
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    if (systemClient) {
      await systemClient.close();
    }
    if (app) {
      await app.close();
    }
  });

  // No beforeEach cleanup - each test uses unique emails to avoid conflicts
  // Tests create their own users and don't interfere with each other

  describe('POST /api/auth.login', () => {
    it('logs in successfully with valid credentials', async () => {
      const email = 'test1@test.com';
      const password = 'password123';
      await createTestUser(email, password);

      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password })
        .expect(201);

      expect(response.body.access_token).toBeDefined();
      expect(typeof response.body.access_token).toBe('string');
      expect(response.body.user).toMatchObject({
        email,
        name: 'Test User',
      });
      expect(response.body.user.id).toBeDefined();
    });

    it('is case-insensitive for email', async () => {
      const email = 'test2@test.com';
      const password = 'password123';
      await createTestUser(email, password);

      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: email.toUpperCase(), password })
        .expect(201);

      expect(response.body.access_token).toBeDefined();
    });

    it('creates a session with IP and user agent', async () => {
      const email = 'test3@test.com';
      const password = 'password123';
      const userId = await createTestUser(email, password);

      await request(app.getHttpServer())
        .post('/api/auth.login')
        .set('X-Forwarded-For', '192.168.1.1, 10.0.0.1')
        .set('User-Agent', 'Mozilla/5.0 Test Browser')
        .send({ email, password })
        .expect(201);

      // Verify session was created with metadata
      await new Promise((resolve) => setTimeout(resolve, 100));
      const sessions = await systemClient.query({
        query: 'SELECT * FROM sessions FINAL WHERE user_id = {userId:String}',
        query_params: { userId },
        format: 'JSONEachRow',
      });
      const sessionRows = await sessions.json<any>();

      expect(sessionRows).toHaveLength(1);
      expect(sessionRows[0].ip_address).toBe('192.168.1.1');
      expect(sessionRows[0].user_agent).toBe('Mozilla/5.0 Test Browser');
    });

    it('resets failed login attempts on successful login', async () => {
      const email = 'test4@test.com';
      const password = 'password123';
      await createTestUser(email, password, { failedAttempts: 3 });

      await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password })
        .expect(201);

      // Verify failed attempts reset
      await new Promise((resolve) => setTimeout(resolve, 100));
      const users = await systemClient.query({
        query: 'SELECT * FROM users FINAL WHERE email = {email:String}',
        query_params: { email },
        format: 'JSONEachRow',
      });
      const userRows = await users.json<any>();

      expect(userRows[0].failed_login_attempts).toBe(0);
      expect(userRows[0].locked_until).toBeNull();
    });

    it('fails with wrong password', async () => {
      const email = 'test5@test.com';
      await createTestUser(email, 'correctpassword');

      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password: 'wrongpassword' })
        .expect(401);

      expect(response.body.message).toContain('Invalid credentials');
    });

    it('fails with non-existent user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: 'nonexistent@test.com', password: 'password123' })
        .expect(401);

      expect(response.body.message).toContain('Invalid credentials');
    });

    it('increments failed login attempts on wrong password', async () => {
      const email = 'test6@test.com';
      await createTestUser(email, 'correctpassword');

      // First failed attempt
      await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password: 'wrongpassword' })
        .expect(401);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify failed attempts incremented
      const users = await systemClient.query({
        query: 'SELECT * FROM users FINAL WHERE email = {email:String}',
        query_params: { email },
        format: 'JSONEachRow',
      });
      const userRows = await users.json<any>();

      expect(userRows[0].failed_login_attempts).toBe(1);
    });

    it('locks account after 5 failed login attempts', async () => {
      const email = 'test7@test.com';
      await createTestUser(email, 'correctpassword');

      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/auth.login')
          .send({ email, password: 'wrongpassword' });
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify account is locked
      const users = await systemClient.query({
        query: 'SELECT * FROM users FINAL WHERE email = {email:String}',
        query_params: { email },
        format: 'JSONEachRow',
      });
      const userRows = await users.json<any>();

      expect(userRows[0].failed_login_attempts).toBe(5);
      expect(userRows[0].locked_until).not.toBeNull();

      // Verify locked until is approximately 15 minutes in future
      const lockedUntil = new Date(userRows[0].locked_until);
      const now = new Date();
      const diffMinutes = (lockedUntil.getTime() - now.getTime()) / (1000 * 60);
      expect(diffMinutes).toBeGreaterThan(14);
      expect(diffMinutes).toBeLessThan(16);
    });

    it('blocks login when account is locked', async () => {
      const email = 'test8@test.com';
      const lockedUntil = toClickHouseDateTime(
        new Date(Date.now() + 15 * 60 * 1000),
      );
      await createTestUser(email, 'password123', {
        failedAttempts: 5,
        lockedUntil,
      });

      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password: 'password123' })
        .expect(401);

      expect(response.body.message).toContain('Account temporarily locked');
      expect(response.body.message).toContain('15 minutes');
    });

    it('fails when user status is not active', async () => {
      const email = 'test9@test.com';
      await createTestUser(email, 'password123', { status: 'disabled' });

      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password: 'password123' })
        .expect(401);

      expect(response.body.message).toContain('Account is not active');
    });

    it('validates email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: 'not-an-email', password: 'password123' })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('validates required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: 'user@test.com' })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('logs in with legacy admin credentials from env', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_PASSWORD,
        })
        .expect(201);

      expect(response.body.access_token).toBeDefined();
      expect(response.body.user.email).toBe(process.env.ADMIN_EMAIL);
    });
  });

  describe('POST /api/auth.forgotPassword', () => {
    it('returns success for existing email', async () => {
      const email = 'test10@test.com';
      await createTestUser(email, 'password123');

      // Mock the mail service
      const sendPasswordResetSpy = jest
        .spyOn(mailService, 'sendPasswordReset')
        .mockResolvedValue();

      const response = await request(app.getHttpServer())
        .post('/api/auth.forgotPassword')
        .send({ email })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(sendPasswordResetSpy).toHaveBeenCalled();

      sendPasswordResetSpy.mockRestore();
    });

    it('returns success for non-existent email (no enumeration)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.forgotPassword')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('creates password reset token in database', async () => {
      const email = 'test11@test.com';
      const userId = await createTestUser(email, 'password123');

      // Mock the mail service
      jest.spyOn(mailService, 'sendPasswordReset').mockResolvedValue();

      await request(app.getHttpServer())
        .post('/api/auth.forgotPassword')
        .send({ email })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify token was created
      const tokens = await systemClient.query({
        query:
          'SELECT * FROM password_reset_tokens FINAL WHERE user_id = {userId:String}',
        query_params: { userId },
        format: 'JSONEachRow',
      });
      const tokenRows = await tokens.json<any>();

      expect(tokenRows.length).toBeGreaterThan(0);
      expect(tokenRows[0].status).toBe('pending');
      expect(tokenRows[0].token_hash).toBeDefined();

      // Verify expiry is approximately 1 hour in future
      const expiresAt = new Date(tokenRows[0].expires_at);
      const now = new Date();
      const diffMinutes = (expiresAt.getTime() - now.getTime()) / (1000 * 60);
      expect(diffMinutes).toBeGreaterThan(55);
      expect(diffMinutes).toBeLessThan(65);
    });

    it('rate limits to 3 requests per hour', async () => {
      const email = 'test12@test.com';
      const userId = await createTestUser(email, 'password123');

      // Mock the mail service
      const sendPasswordResetSpy = jest
        .spyOn(mailService, 'sendPasswordReset')
        .mockResolvedValue();

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/auth.forgotPassword')
          .send({ email })
          .expect(200);
      }

      expect(sendPasswordResetSpy).toHaveBeenCalledTimes(3);

      // 4th request should still return success but not send email
      await request(app.getHttpServer())
        .post('/api/auth.forgotPassword')
        .send({ email })
        .expect(200);

      // Should still be only 3 emails sent (rate limited)
      expect(sendPasswordResetSpy).toHaveBeenCalledTimes(3);

      sendPasswordResetSpy.mockRestore();
    });

    it('validates email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.forgotPassword')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('POST /api/auth.resetPassword', () => {
    it('resets password with valid token', async () => {
      const email = 'test13@test.com';
      const oldPassword = 'oldpassword';
      const newPassword = 'newpassword123';
      const userId = await createTestUser(email, oldPassword);
      const token = await createPasswordResetToken(userId);

      const response = await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify can login with new password
      await new Promise((resolve) => setTimeout(resolve, 200));
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password: newPassword })
        .expect(201);

      expect(loginResponse.body.access_token).toBeDefined();

      // Verify cannot login with old password
      await request(app.getHttpServer())
        .post('/api/auth.login')
        .send({ email, password: oldPassword })
        .expect(401);
    });

    it('marks token as used after successful reset', async () => {
      const email = 'test14@test.com';
      const userId = await createTestUser(email, 'oldpassword');
      const token = await createPasswordResetToken(userId);

      await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword: 'newpassword123' })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify token is marked as used
      const tokens = await systemClient.query({
        query:
          'SELECT * FROM password_reset_tokens FINAL WHERE user_id = {userId:String}',
        query_params: { userId },
        format: 'JSONEachRow',
      });
      const tokenRows = await tokens.json<any>();

      expect(tokenRows[0].status).toBe('used');
    });

    it('revokes all sessions after password reset', async () => {
      const email = 'test15@test.com';
      const oldPassword = 'oldpassword';
      const userId = await createTestUser(email, oldPassword);

      // Create a session (login)
      const oldToken = await getAuthToken(email, oldPassword);
      expect(oldToken).toBeDefined();

      // Reset password
      const resetToken = await createPasswordResetToken(userId);
      await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token: resetToken, newPassword: 'newpassword123' })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify old token no longer works
      await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);
    });

    it('fails with invalid token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token: 'invalidtoken123', newPassword: 'newpassword123' })
        .expect(400);

      expect(response.body.message).toContain('Invalid or expired reset token');
    });

    it('fails with already used token', async () => {
      const email = 'test16@test.com';
      const userId = await createTestUser(email, 'oldpassword');
      const token = await createPasswordResetToken(userId);

      // Use token once
      await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword: 'newpassword123' })
        .expect(200);

      // Try to use same token again
      const response = await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword: 'anotherpassword' })
        .expect(400);

      expect(response.body.message).toContain('already been used');
    });

    it('fails with expired token', async () => {
      const email = 'test17@test.com';
      const userId = await createTestUser(email, 'oldpassword');

      // Create expired token
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

      await systemClient.insert({
        table: 'password_reset_tokens',
        values: [
          {
            id: generateId(),
            user_id: userId,
            token_hash: tokenHash,
            status: 'pending',
            expires_at: toClickHouseDateTime(expiresAt),
            created_at: toClickHouseDateTime(now),
            updated_at: toClickHouseDateTime(now),
          },
        ],
        format: 'JSONEachRow',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword: 'newpassword123' })
        .expect(400);

      expect(response.body.message).toContain('expired');
    });

    it('validates password length (min 8 chars)', async () => {
      const email = 'test18@test.com';
      const userId = await createTestUser(email, 'oldpassword');
      const token = await createPasswordResetToken(userId);

      const response = await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword: 'short' })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('validates password length (max 72 chars)', async () => {
      const email = 'test19@test.com';
      const userId = await createTestUser(email, 'oldpassword');
      const token = await createPasswordResetToken(userId);

      const tooLongPassword = 'a'.repeat(73);
      const response = await request(app.getHttpServer())
        .post('/api/auth.resetPassword')
        .send({ token, newPassword: tooLongPassword })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('GET /api/auth.sessions', () => {
    it('returns active sessions for authenticated user', async () => {
      const email = 'test20@test.com';
      const password = 'password123';
      await createTestUser(email, password);

      const token = await getAuthToken(email, password);

      const response = await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('user_id');
      expect(response.body[0]).toHaveProperty('expires_at');
      expect(response.body[0]).toHaveProperty('created_at');
      // Should not expose token_hash
      expect(response.body[0].token_hash).toBeUndefined();
    });

    it('does not return revoked sessions', async () => {
      const email = 'test21@test.com';
      const password = 'password123';
      const userId = await createTestUser(email, password);

      // Create revoked session directly
      const now = new Date();
      await systemClient.insert({
        table: 'sessions',
        values: [
          {
            id: generateId(),
            user_id: userId,
            token_hash: 'somehash',
            ip_address: null,
            user_agent: null,
            expires_at: toClickHouseDateTime(
              new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            ),
            revoked_at: toClickHouseDateTime(now),
            created_at: toClickHouseDateTime(now),
            updated_at: toClickHouseDateTime(now),
          },
        ],
        format: 'JSONEachRow',
      });

      const token = await getAuthToken(email, password);

      const response = await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Should only return the active session from login, not the revoked one
      expect(response.body.length).toBe(1);
      expect(response.body[0].revoked_at).toBeNull();
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/auth.sessions').expect(401);
    });
  });

  describe('POST /api/auth.revokeSession', () => {
    it('revokes a specific session', async () => {
      const email = 'test22@test.com';
      const password = 'password123';
      await createTestUser(email, password);

      // Create two sessions
      const token1 = await getAuthToken(email, password);
      const token2 = await getAuthToken(email, password);

      // Get sessions list
      const sessionsResponse = await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(sessionsResponse.body.length).toBe(2);

      // Revoke first session
      const sessionId = sessionsResponse.body[0].id;
      const response = await request(app.getHttpServer())
        .post('/api/auth.revokeSession')
        .query({ sessionId })
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify only one session remains
      await new Promise((resolve) => setTimeout(resolve, 100));
      const updatedSessions = await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);

      expect(updatedSessions.body.length).toBe(1);
      expect(updatedSessions.body[0].id).not.toBe(sessionId);
    });

    it('fails when revoking another user\'s session', async () => {
      const email1 = 'revoke1@test.com';
      const email2 = 'revoke2@test.com';
      await createTestUser(email1, 'password123');
      await createTestUser(email2, 'password123');

      const token1 = await getAuthToken(email1, 'password123');
      const token2 = await getAuthToken(email2, 'password123');

      // Get user1's session
      const sessions = await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      const sessionId = sessions.body[0].id;

      // Try to revoke user1's session as user2
      const response = await request(app.getHttpServer())
        .post('/api/auth.revokeSession')
        .query({ sessionId })
        .set('Authorization', `Bearer ${token2}`)
        .expect(400);

      expect(response.body.message).toContain('Session not found');
    });

    it('fails with invalid session ID', async () => {
      const email = 'test23@test.com';
      await createTestUser(email, 'password123');
      const token = await getAuthToken(email, 'password123');

      const response = await request(app.getHttpServer())
        .post('/api/auth.revokeSession')
        .query({ sessionId: 'invalid-session-id' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body.message).toContain('Session not found');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/auth.revokeSession')
        .query({ sessionId: 'some-id' })
        .expect(401);
    });
  });

  describe('POST /api/auth.revokeAllSessions', () => {
    it('revokes all sessions for the user', async () => {
      const email = 'test24@test.com';
      const password = 'password123';
      await createTestUser(email, password);

      // Create multiple sessions
      const token1 = await getAuthToken(email, password);
      const token2 = await getAuthToken(email, password);
      const token3 = await getAuthToken(email, password);

      // Verify we have 3 sessions
      const sessionsResponse = await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(sessionsResponse.body.length).toBe(3);

      // Revoke all sessions
      const response = await request(app.getHttpServer())
        .post('/api/auth.revokeAllSessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify all tokens are now invalid
      await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token2}`)
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token3}`)
        .expect(401);
    });

    it('only revokes sessions for the authenticated user', async () => {
      const email1 = 'revokeall1@test.com';
      const email2 = 'revokeall2@test.com';
      await createTestUser(email1, 'password123');
      await createTestUser(email2, 'password123');

      const token1 = await getAuthToken(email1, 'password123');
      const token2 = await getAuthToken(email2, 'password123');

      // User 1 revokes all sessions
      await request(app.getHttpServer())
        .post('/api/auth.revokeAllSessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // User 1's token should be invalid
      await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(401);

      // User 2's token should still work
      await request(app.getHttpServer())
        .get('/api/auth.sessions')
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/auth.revokeAllSessions')
        .expect(401);
    });
  });
});
