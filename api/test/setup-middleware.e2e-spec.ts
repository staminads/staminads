// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import request from 'supertest';
import {
  createTestApp,
  closeTestApp,
  waitForClickHouse,
  TestAppContext,
} from './helpers';

describe('Setup Middleware', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    systemClient = ctx.systemClient;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  describe('when setup is not complete', () => {
    beforeEach(async () => {
      // Remove setup_completed setting to simulate incomplete setup
      await systemClient.command({
        query: `ALTER TABLE system_settings DELETE WHERE key = 'setup_completed'`,
      });
      await waitForClickHouse();
    });

    afterEach(async () => {
      // Restore setup_completed setting
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'setup_completed',
            value: 'true',
            updated_at: now,
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();
    });

    it('allows non-API routes through (for console static files)', async () => {
      // In tests there's no /public folder, so we get 404, but importantly NOT 503
      // This proves the middleware allows non-API routes through
      const response = await request(ctx.app.getHttpServer()).get('/');

      // Should NOT be 503 (setup_required) - middleware passes through non-API routes
      expect(response.status).not.toBe(503);
      expect(response.body).not.toEqual({
        error: 'setup_required',
        message: 'Initial setup has not been completed',
      });
    });

    it('allows /api/setup routes', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/setup.status')
        .expect(200);

      expect(response.body.setupCompleted).toBe(false);
    });

    it('blocks other API routes with 503', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/workspaces.list')
        .expect(503);

      expect(response.body).toEqual({
        error: 'setup_required',
        message: 'Initial setup has not been completed',
      });
    });

    it('blocks POST API routes with 503', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/auth.login')
        .send({ email: 'test@test.com', password: 'password' })
        .expect(503);

      expect(response.body).toEqual({
        error: 'setup_required',
        message: 'Initial setup has not been completed',
      });
    });
  });

  describe('when setup is complete', () => {
    it('allows API routes (returns 401 for auth-required, not 503)', async () => {
      const response = await request(ctx.app.getHttpServer()).get(
        '/api/workspaces.list',
      );

      // Should not be 503 (setup_required) - setup is complete
      expect(response.status).not.toBe(503);
      // Should be 401 (unauthorized) since we're not authenticated
      expect(response.status).toBe(401);
    });

    it('allows non-API routes', async () => {
      const response = await request(ctx.app.getHttpServer()).get('/');

      // Should NOT be 503 (setup_required)
      expect(response.status).not.toBe(503);
    });
  });
});
