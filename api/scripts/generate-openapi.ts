// NOTE: This script must be run AFTER `nest build` to pick up CLI plugin transformations
// Use: npm run build && node dist/scripts/generate-openapi.js

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

async function generateOpenApiSpec() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Staminads API')
    .setDescription('Web analytics platform for tracking TimeScore metrics')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'jwt-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'secret',
        in: 'query',
        description: 'Demo secret for demo endpoints',
      },
      'demo-secret',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'API key in format: sk_live_...',
      },
      'api-key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Write to project root (go up from dist/scripts to project root)
  const projectRoot = path.resolve(__dirname, '..', '..');
  const jsonPath = path.join(projectRoot, 'openapi.json');
  fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2));
  console.log(`OpenAPI spec written to ${jsonPath}`);

  // Write YAML
  const yamlPath = path.join(projectRoot, 'openapi.yaml');
  fs.writeFileSync(yamlPath, yaml.stringify(document));
  console.log(`OpenAPI spec written to ${yamlPath}`);

  await app.close();
}

generateOpenApiSpec();
