// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://console.example.com',
];
setupTestEnv({ corsOrigins: ALLOWED_ORIGINS });

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('CORS Configuration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Configure CORS the same way as main.ts
    const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
    const allowedOrigins = allowedOriginsEnv
      ? allowedOriginsEnv
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [];

    const corsOptionsDelegate: CorsOptionsDelegate<Request> = (
      req,
      callback,
    ) => {
      const origin = req.headers.origin;
      const path = req.url || '';

      // Track endpoints: always allow all origins
      if (path.startsWith('/api/track')) {
        return callback(null, { origin: true, credentials: true });
      }

      // Other endpoints: check allowed origins
      if (allowedOrigins.length === 0) {
        return callback(null, { origin: true, credentials: true });
      }

      const allowed = !origin || allowedOrigins.includes(origin);
      callback(null, { origin: allowed, credentials: true });
    };

    app.enableCors(corsOptionsDelegate);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Track endpoints (always permissive)', () => {
    it('allows any origin for /api/track', async () => {
      const randomOrigin = 'https://random-customer-site.com';

      const response = await request(app.getHttpServer())
        .options('/api/track')
        .set('Origin', randomOrigin)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBe(
        randomOrigin,
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Console endpoints (restricted)', () => {
    it('allows requests from configured origins', async () => {
      const allowedOrigin = ALLOWED_ORIGINS[0];

      const response = await request(app.getHttpServer())
        .options('/api/auth.login')
        .set('Origin', allowedOrigin)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBe(
        allowedOrigin,
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('allows requests from second configured origin', async () => {
      const allowedOrigin = ALLOWED_ORIGINS[1];

      const response = await request(app.getHttpServer())
        .options('/api/workspaces.list')
        .set('Origin', allowedOrigin)
        .set('Access-Control-Request-Method', 'GET');

      expect(response.headers['access-control-allow-origin']).toBe(
        allowedOrigin,
      );
    });

    it('blocks requests from non-configured origins', async () => {
      const disallowedOrigin = 'https://evil-site.com';

      const response = await request(app.getHttpServer())
        .options('/api/auth.login')
        .set('Origin', disallowedOrigin)
        .set('Access-Control-Request-Method', 'POST');

      // When origin is not allowed, Access-Control-Allow-Origin should be absent or false
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows requests without Origin header (same-origin, curl, etc)', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/auth.login')
        .set('Access-Control-Request-Method', 'POST');

      // No origin header means same-origin request, should be allowed
      expect(response.status).toBeLessThan(400);
    });
  });

  describe('CORS headers', () => {
    it('includes credentials header for allowed origins', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/auth.login')
        .set('Origin', ALLOWED_ORIGINS[0])
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('includes allowed methods header', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/auth.login')
        .set('Origin', ALLOWED_ORIGINS[0])
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });
});

describe('CORS with no CORS_ALLOWED_ORIGINS (default permissive)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Clear CORS env var to test default behavior
    delete process.env.CORS_ALLOWED_ORIGINS;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Configure CORS with empty allowed origins (default permissive)
    const corsOptionsDelegate: CorsOptionsDelegate<Request> = (
      req,
      callback,
    ) => {
      const path = req.url || '';

      if (path.startsWith('/api/track')) {
        return callback(null, { origin: true, credentials: true });
      }

      // Empty array = allow all origins
      callback(null, { origin: true, credentials: true });
    };

    app.enableCors(corsOptionsDelegate);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows any origin when CORS_ALLOWED_ORIGINS is not set', async () => {
    const anyOrigin = 'https://any-site.com';

    const response = await request(app.getHttpServer())
      .options('/api/auth.login')
      .set('Origin', anyOrigin)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBe(anyOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
