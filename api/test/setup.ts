import { createClient, ClickHouseClient } from '@clickhouse/client';
import { SCHEMAS } from '../src/database/schemas';

const TEST_DATABASE = 'staminads_test';

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

  // Create test database
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${TEST_DATABASE}` });

  // Create all tables from schemas
  for (const schema of Object.values(SCHEMAS)) {
    const query = schema.replace(/{database}/g, TEST_DATABASE);
    await ch.command({ query });
  }

  console.log(`Test database ${TEST_DATABASE} initialized`);
}

export async function teardown(): Promise<void> {
  const ch = await getClient();
  await ch.command({ query: `DROP DATABASE IF EXISTS ${TEST_DATABASE}` });
  await ch.close();
  console.log(`Test database ${TEST_DATABASE} dropped`);
}

// Default export for Jest globalSetup
export default setup;
