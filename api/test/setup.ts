import { createClient, ClickHouseClient } from '@clickhouse/client';
import * as bcrypt from 'bcrypt';
import { SYSTEM_SCHEMAS, WORKSPACE_SCHEMAS } from '../src/database/schemas';
import { generateId } from '../src/common/crypto';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';
const TEST_WORKSPACE_DATABASE = 'staminads_test_ws';

// Additional workspace databases for specific tests
// Format: staminads_ws_{workspace_id} to match ClickHouseService.getWorkspaceDatabaseName()
const ADDITIONAL_WORKSPACE_DATABASES = [
  'staminads_ws_backfill_test_ws',
  'staminads_ws_test_ws',
  'staminads_ws_analytics_test_ws',
  'staminads_ws_page_tracking_test_ws',
  'staminads_ws_test_ws_v3',
];

let client: ClickHouseClient;

async function getClient(): Promise<ClickHouseClient> {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
  }
  return client;
}

async function createWorkspaceDatabase(
  ch: ClickHouseClient,
  dbName: string,
): Promise<void> {
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${dbName}` });
  for (const schema of Object.values(WORKSPACE_SCHEMAS)) {
    const query = schema.replace(/{database}/g, dbName);
    await ch.command({ query });
  }
}

export async function setup(): Promise<void> {
  const ch = await getClient();

  // Create test system database
  await ch.command({
    query: `CREATE DATABASE IF NOT EXISTS ${TEST_SYSTEM_DATABASE}`,
  });

  // Create system tables
  for (const schema of Object.values(SYSTEM_SCHEMAS)) {
    const query = schema.replace(/{database}/g, TEST_SYSTEM_DATABASE);
    await ch.command({ query });
  }

  // Mark setup as complete for tests (required by SetupMiddleware)
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
  await ch.insert({
    table: `${TEST_SYSTEM_DATABASE}.system_settings`,
    values: [
      {
        key: 'setup_completed',
        value: 'true',
        updated_at: now,
      },
    ],
    format: 'JSONEachRow',
  });

  // Create admin test user (used by tests expecting ADMIN_EMAIL/ADMIN_PASSWORD)
  const adminPasswordHash = await bcrypt.hash('testpass', 10);
  await ch.insert({
    table: `${TEST_SYSTEM_DATABASE}.users`,
    values: [
      {
        id: generateId(),
        email: 'super-admin@test.com',
        password_hash: adminPasswordHash,
        name: 'Test Admin',
        type: 'user',
        status: 'active',
        is_super_admin: 1,
        failed_login_attempts: 0,
        created_at: now,
        updated_at: now,
      },
    ],
    format: 'JSONEachRow',
  });

  // Create main test workspace database
  await createWorkspaceDatabase(ch, TEST_WORKSPACE_DATABASE);

  // Create additional workspace databases for specific tests
  for (const db of ADDITIONAL_WORKSPACE_DATABASES) {
    await createWorkspaceDatabase(ch, db);
  }

  const allDatabases = [
    TEST_WORKSPACE_DATABASE,
    ...ADDITIONAL_WORKSPACE_DATABASES,
  ].join(', ');
  console.log(
    `Test databases ${TEST_SYSTEM_DATABASE} and ${allDatabases} initialized`,
  );
}

export async function teardown(): Promise<void> {
  const ch = await getClient();
  await ch.command({
    query: `DROP DATABASE IF EXISTS ${TEST_SYSTEM_DATABASE}`,
  });
  await ch.command({
    query: `DROP DATABASE IF EXISTS ${TEST_WORKSPACE_DATABASE}`,
  });
  for (const db of ADDITIONAL_WORKSPACE_DATABASES) {
    await ch.command({ query: `DROP DATABASE IF EXISTS ${db}` });
  }
  await ch.close();
  const allDatabases = [
    TEST_WORKSPACE_DATABASE,
    ...ADDITIONAL_WORKSPACE_DATABASES,
  ].join(', ');
  console.log(
    `Test databases ${TEST_SYSTEM_DATABASE} and ${allDatabases} dropped`,
  );
}

// Default export for Jest globalSetup
export default setup;
