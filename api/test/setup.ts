import { createClient, ClickHouseClient } from '@clickhouse/client';
import { SYSTEM_SCHEMAS, WORKSPACE_SCHEMAS } from '../src/database/schemas';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';
const TEST_WORKSPACE_DATABASE = 'staminads_test_ws';

// Additional workspace databases for specific tests
const ADDITIONAL_WORKSPACE_DATABASES = [
  'staminads_ws_backfill_test_ws',
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

async function createWorkspaceDatabase(ch: ClickHouseClient, dbName: string): Promise<void> {
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${dbName}` });
  for (const schema of Object.values(WORKSPACE_SCHEMAS)) {
    const query = schema.replace(/{database}/g, dbName);
    await ch.command({ query });
  }
}

export async function setup(): Promise<void> {
  const ch = await getClient();

  // Create test system database
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${TEST_SYSTEM_DATABASE}` });

  // Create system tables
  for (const schema of Object.values(SYSTEM_SCHEMAS)) {
    const query = schema.replace(/{database}/g, TEST_SYSTEM_DATABASE);
    await ch.command({ query });
  }

  // Create main test workspace database
  await createWorkspaceDatabase(ch, TEST_WORKSPACE_DATABASE);

  // Create additional workspace databases for specific tests
  for (const db of ADDITIONAL_WORKSPACE_DATABASES) {
    await createWorkspaceDatabase(ch, db);
  }

  const allDatabases = [TEST_WORKSPACE_DATABASE, ...ADDITIONAL_WORKSPACE_DATABASES].join(', ');
  console.log(`Test databases ${TEST_SYSTEM_DATABASE} and ${allDatabases} initialized`);
}

export async function teardown(): Promise<void> {
  const ch = await getClient();
  await ch.command({ query: `DROP DATABASE IF EXISTS ${TEST_SYSTEM_DATABASE}` });
  await ch.command({ query: `DROP DATABASE IF EXISTS ${TEST_WORKSPACE_DATABASE}` });
  for (const db of ADDITIONAL_WORKSPACE_DATABASES) {
    await ch.command({ query: `DROP DATABASE IF EXISTS ${db}` });
  }
  await ch.close();
  const allDatabases = [TEST_WORKSPACE_DATABASE, ...ADDITIONAL_WORKSPACE_DATABASES].join(', ');
  console.log(`Test databases ${TEST_SYSTEM_DATABASE} and ${allDatabases} dropped`);
}

// Default export for Jest globalSetup
export default setup;
