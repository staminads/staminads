import { ValidationPipe } from '@nestjs/common';
import { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';
import { Request } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Parse allowed origins from env (empty array = allow all)
  const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  // Route-aware CORS: track endpoints always permissive, others check list
  const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
    const origin = req.headers.origin;
    const path = req.url || '';

    // Track endpoints: always allow all origins (SDK on customer websites)
    if (path.startsWith('/api/track')) {
      return callback(null, { origin: true, credentials: true });
    }

    // Other endpoints: check allowed origins
    if (allowedOrigins.length === 0) {
      // Default: allow all origins when env var not set
      return callback(null, { origin: true, credentials: true });
    }

    // Strict mode: only allow listed origins
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
  await app.listen(process.env.PORT ?? 3000, 'localapi.staminads.com');
}
bootstrap();
