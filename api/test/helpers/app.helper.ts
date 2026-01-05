/**
 * NestJS test application bootstrap helper
 *
 * Provides consistent app initialization across all e2e tests,
 * eliminating bootstrap code duplication.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/mail/mail.service';
import {
  getSystemClientConfig,
  getWorkspaceClientConfig,
} from '../constants/test-config';
import { getWorkspaceDatabaseName } from './workspace.helper';

export interface TestAppContext {
  /** NestJS application instance */
  app: INestApplication;
  /** Testing module for accessing services */
  moduleFixture: TestingModule;
  /** ClickHouse client for system database */
  systemClient: ClickHouseClient;
  /** ClickHouse client for workspace database (if workspaceId provided) */
  workspaceClient?: ClickHouseClient;
  /** Mail service (if mocked) */
  mailService?: MailService;
}

export interface CreateTestAppOptions {
  /** Workspace ID for workspace-specific tests */
  workspaceId?: string;
  /** Whether to mock the MailService */
  mockMailService?: boolean;
  /** CORS allowed origins (for CORS tests) */
  corsOrigins?: string[];
  /** Custom CORS options delegate */
  corsOptionsDelegate?: (req: unknown, callback: unknown) => void;
}

/**
 * Create and initialize a NestJS test application with ClickHouse clients.
 *
 * @param options - Configuration options
 * @returns Test app context with app, clients, and services
 *
 * @example
 * // Basic usage
 * const ctx = await createTestApp();
 *
 * // With workspace client
 * const ctx = await createTestApp({ workspaceId: 'test_ws' });
 *
 * // With mail service mocking
 * const ctx = await createTestApp({ mockMailService: true });
 *
 * // With CORS configuration
 * const ctx = await createTestApp({ corsOrigins: ['http://localhost:5173'] });
 */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestAppContext> {
  const { workspaceId, mockMailService, corsOptionsDelegate } = options;

  // Create and compile testing module
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // Create application
  const app = moduleFixture.createNestApplication();

  // Configure validation pipe (consistent across all tests)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Configure CORS if delegate provided
  if (corsOptionsDelegate) {
    app.enableCors(corsOptionsDelegate);
  }

  // Initialize app
  await app.init();

  // Create ClickHouse clients
  const systemClient = createClient(getSystemClientConfig());

  let workspaceClient: ClickHouseClient | undefined;
  if (workspaceId) {
    workspaceClient = createClient({
      ...getSystemClientConfig(),
      database: getWorkspaceDatabaseName(workspaceId),
    });
  }

  // Setup mail service mocking if requested
  let mailService: MailService | undefined;
  if (mockMailService) {
    mailService = moduleFixture.get<MailService>(MailService);
    jest.spyOn(mailService, 'sendPasswordReset').mockResolvedValue();
    jest.spyOn(mailService, 'sendInvitation').mockResolvedValue();
    jest.spyOn(mailService, 'sendWelcome').mockResolvedValue();
  }

  return {
    app,
    moduleFixture,
    systemClient,
    workspaceClient,
    mailService,
  };
}

/**
 * Create test app with workspace client using default test workspace database.
 *
 * @returns Test app context with workspace client
 *
 * @example
 * const ctx = await createTestAppWithWorkspace();
 */
export async function createTestAppWithWorkspace(): Promise<TestAppContext> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.init();

  const systemClient = createClient(getSystemClientConfig());
  const workspaceClient = createClient(getWorkspaceClientConfig());

  return {
    app,
    moduleFixture,
    systemClient,
    workspaceClient,
  };
}

/**
 * Close app and database connections.
 *
 * @param context - Test app context to close
 *
 * @example
 * afterAll(async () => {
 *   await closeTestApp(ctx);
 * });
 */
export async function closeTestApp(context: TestAppContext): Promise<void> {
  const { app, systemClient, workspaceClient } = context;

  await systemClient.close();
  if (workspaceClient) {
    await workspaceClient.close();
  }
  await app.close();
}

/**
 * Get a service from the test module.
 *
 * @param context - Test app context
 * @param serviceClass - Service class to retrieve
 * @returns Service instance
 *
 * @example
 * const eventBuffer = getService(ctx, EventBufferService);
 */
export function getService<T>(
  context: TestAppContext,
  serviceClass: new (...args: unknown[]) => T,
): T {
  return context.moduleFixture.get<T>(serviceClass);
}
