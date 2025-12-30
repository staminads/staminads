import { createClient, ClickHouseClient } from '@clickhouse/client';
import { SYSTEM_SCHEMAS, WORKSPACE_SCHEMAS } from '../src/database/schemas';

const TEST_SYSTEM_DATABASE = 'staminads_test_system';
const TEST_WORKSPACE_DATABASE = 'staminads_test_ws';

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

export async function setup(): Promise<void> {
  const ch = await getClient();

  // Create test system database
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${TEST_SYSTEM_DATABASE}` });

  // Create system tables
  for (const schema of Object.values(SYSTEM_SCHEMAS)) {
    const query = schema.replace(/{database}/g, TEST_SYSTEM_DATABASE);
    await ch.command({ query });
  }

  // Create test workspace database
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${TEST_WORKSPACE_DATABASE}` });

  // Create workspace tables
  for (const schema of Object.values(WORKSPACE_SCHEMAS)) {
    const query = schema.replace(/{database}/g, TEST_WORKSPACE_DATABASE);
    await ch.command({ query });
  }

  console.log(`Test databases ${TEST_SYSTEM_DATABASE} and ${TEST_WORKSPACE_DATABASE} initialized`);
}

export async function teardown(): Promise<void> {
  const ch = await getClient();
  await ch.command({ query: `DROP DATABASE IF EXISTS ${TEST_SYSTEM_DATABASE}` });
  await ch.command({ query: `DROP DATABASE IF EXISTS ${TEST_WORKSPACE_DATABASE}` });
  await ch.close();
  console.log(`Test databases ${TEST_SYSTEM_DATABASE} and ${TEST_WORKSPACE_DATABASE} dropped`);
}

// Default export for Jest globalSetup
export default setup;
