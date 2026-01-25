/**
 * ClickHouse helper for E2E tests
 *
 * Provides database setup, cleanup, and query methods for verifying
 * SDK tracking data is correctly stored in ClickHouse.
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';

// Inline schemas from API (to avoid TypeScript/ESM import issues)
// These must be kept in sync with api/src/database/schemas.ts

const SYSTEM_SCHEMAS: Record<string, string> = {
  workspaces: `
    CREATE TABLE IF NOT EXISTS {database}.workspaces (
      id String,
      name String,
      website String,
      timezone String,
      currency String,
      logo_url Nullable(String),
      settings String DEFAULT '{}',
      status Enum8('initializing' = 1, 'active' = 2, 'inactive' = 3, 'error' = 4),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = MergeTree()
    ORDER BY id
  `,

  system_settings: `
    CREATE TABLE IF NOT EXISTS {database}.system_settings (
      key String,
      value String,
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (key)
  `,
};

const WORKSPACE_SCHEMAS: Record<string, string> = {
  events: `
    CREATE TABLE IF NOT EXISTS {database}.events (
      id UUID DEFAULT generateUUIDv4(),
      session_id String,
      workspace_id String,
      received_at DateTime64(3),
      created_at DateTime64(3),
      updated_at DateTime64(3),
      name LowCardinality(String),
      path String,
      duration UInt64 DEFAULT 0,
      page_duration UInt32 DEFAULT 0,
      previous_path String DEFAULT '',
      referrer String DEFAULT '',
      referrer_domain String DEFAULT '',
      referrer_path String DEFAULT '',
      is_direct Bool DEFAULT false,
      landing_page String,
      landing_domain String DEFAULT '',
      landing_path String DEFAULT '',
      utm_source String DEFAULT '',
      utm_medium String DEFAULT '',
      utm_campaign String DEFAULT '',
      utm_term String DEFAULT '',
      utm_content String DEFAULT '',
      utm_id String DEFAULT '',
      utm_id_from String DEFAULT '',
      channel LowCardinality(String) DEFAULT '',
      channel_group LowCardinality(String) DEFAULT '',
      stm_1 String DEFAULT '',
      stm_2 String DEFAULT '',
      stm_3 String DEFAULT '',
      stm_4 String DEFAULT '',
      stm_5 String DEFAULT '',
      stm_6 String DEFAULT '',
      stm_7 String DEFAULT '',
      stm_8 String DEFAULT '',
      stm_9 String DEFAULT '',
      stm_10 String DEFAULT '',
      screen_width UInt16 DEFAULT 0,
      screen_height UInt16 DEFAULT 0,
      viewport_width UInt16 DEFAULT 0,
      viewport_height UInt16 DEFAULT 0,
      device String DEFAULT '',
      browser String DEFAULT '',
      browser_type String DEFAULT '',
      os String DEFAULT '',
      user_agent String DEFAULT '',
      connection_type String DEFAULT '',
      language String DEFAULT '',
      timezone String DEFAULT '',
      country LowCardinality(String) DEFAULT '',
      region LowCardinality(String) DEFAULT '',
      city String DEFAULT '',
      latitude Nullable(Float32),
      longitude Nullable(Float32),
      max_scroll UInt8 DEFAULT 0,
      page_number UInt16 DEFAULT 0,
      _version UInt64 DEFAULT 0,
      goal_name String DEFAULT '',
      goal_value Float32 DEFAULT 0,
      dedup_token String DEFAULT '',
      sdk_version String DEFAULT '',
      properties Map(String, String) DEFAULT map(),
      entered_at DateTime64(3),
      exited_at DateTime64(3),
      goal_timestamp Nullable(DateTime64(3)),
      user_id Nullable(String),
      INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = MergeTree()
    PARTITION BY toYYYYMMDD(received_at)
    ORDER BY (session_id, received_at)
    TTL toDateTime(received_at) + INTERVAL 7 DAY
  `,

  sessions: `
    CREATE TABLE IF NOT EXISTS {database}.sessions (
      id String,
      workspace_id String,
      created_at DateTime64(3),
      updated_at DateTime64(3),
      duration UInt32 DEFAULT 0,
      pageview_count UInt16 DEFAULT 1,
      median_page_duration UInt32 DEFAULT 0,
      year UInt16,
      month UInt8,
      day UInt8,
      day_of_week UInt8,
      week_number UInt8,
      hour UInt8,
      is_weekend Bool,
      referrer String DEFAULT '',
      referrer_domain String DEFAULT '',
      referrer_path String DEFAULT '',
      is_direct Bool,
      landing_page String,
      landing_domain String DEFAULT '',
      landing_path String DEFAULT '',
      exit_path String DEFAULT '',
      utm_source String DEFAULT '',
      utm_medium String DEFAULT '',
      utm_campaign String DEFAULT '',
      utm_term String DEFAULT '',
      utm_content String DEFAULT '',
      utm_id String DEFAULT '',
      utm_id_from String DEFAULT '',
      channel LowCardinality(String) DEFAULT '',
      channel_group LowCardinality(String) DEFAULT '',
      stm_1 String DEFAULT '',
      stm_2 String DEFAULT '',
      stm_3 String DEFAULT '',
      stm_4 String DEFAULT '',
      stm_5 String DEFAULT '',
      stm_6 String DEFAULT '',
      stm_7 String DEFAULT '',
      stm_8 String DEFAULT '',
      stm_9 String DEFAULT '',
      stm_10 String DEFAULT '',
      screen_width UInt16 DEFAULT 0,
      screen_height UInt16 DEFAULT 0,
      viewport_width UInt16 DEFAULT 0,
      viewport_height UInt16 DEFAULT 0,
      user_agent String DEFAULT '',
      language String DEFAULT '',
      timezone String DEFAULT '',
      country LowCardinality(String) DEFAULT '',
      region LowCardinality(String) DEFAULT '',
      city String DEFAULT '',
      latitude Nullable(Float32),
      longitude Nullable(Float32),
      browser String DEFAULT '',
      browser_type String DEFAULT '',
      os String DEFAULT '',
      device String DEFAULT '',
      connection_type String DEFAULT '',
      max_scroll UInt8 DEFAULT 0,
      goal_count UInt16 DEFAULT 0,
      goal_value Float32 DEFAULT 0,
      sdk_version String DEFAULT '',
      user_id Nullable(String),
      INDEX idx_created_at created_at TYPE minmax GRANULARITY 1,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(updated_at)
    PARTITION BY toYYYYMM(created_at)
    ORDER BY (created_at, id)
  `,

  pages: `
    CREATE TABLE IF NOT EXISTS {database}.pages (
      id UUID DEFAULT generateUUIDv4(),
      page_id String DEFAULT '',
      session_id String,
      workspace_id String,
      path String,
      full_url String DEFAULT '',
      entered_at DateTime64(3),
      exited_at DateTime64(3),
      duration UInt32 DEFAULT 0,
      max_scroll UInt8 DEFAULT 0,
      page_number UInt16 DEFAULT 1,
      is_landing Bool DEFAULT false,
      is_exit Bool DEFAULT false,
      entry_type LowCardinality(String) DEFAULT 'navigation',
      user_id Nullable(String),
      received_at DateTime64(3) DEFAULT now64(3),
      _version UInt64 DEFAULT 0,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(_version)
    PARTITION BY toYYYYMMDD(received_at)
    ORDER BY (session_id, page_number)
  `,
};

const SYSTEM_DATABASE = 'staminads_sdk_e2e_system';
const WORKSPACE_ID = 'test_workspace';
const WORKSPACE_DATABASE = `staminads_ws_${WORKSPACE_ID}`;

let systemClient: ClickHouseClient | null = null;
let workspaceClient: ClickHouseClient | null = null;

/**
 * Get or create system database client
 */
export function getSystemClient(): ClickHouseClient {
  if (!systemClient) {
    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
      database: SYSTEM_DATABASE,
    });
  }
  return systemClient;
}

/**
 * Get or create workspace database client
 */
export function getWorkspaceClient(): ClickHouseClient {
  if (!workspaceClient) {
    workspaceClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
      database: WORKSPACE_DATABASE,
    });
  }
  return workspaceClient;
}

/**
 * Initialize test databases and workspace
 * Called from global-setup.ts
 */
export async function initializeTestDatabases(): Promise<void> {
  // Create a client without database for database creation
  const rootClient = createClient({
    url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });

  try {
    // Drop existing databases to ensure fresh schema
    await rootClient.command({
      query: `DROP DATABASE IF EXISTS ${SYSTEM_DATABASE}`,
    });
    await rootClient.command({
      query: `DROP DATABASE IF EXISTS ${WORKSPACE_DATABASE}`,
    });

    // Create system database
    await rootClient.command({
      query: `CREATE DATABASE IF NOT EXISTS ${SYSTEM_DATABASE}`,
    });

    // Create system tables
    for (const schema of Object.values(SYSTEM_SCHEMAS)) {
      const query = schema.replace(/{database}/g, SYSTEM_DATABASE);
      await rootClient.command({ query });
    }

    // Mark setup as complete (required by SetupMiddleware)
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await rootClient.insert({
      table: `${SYSTEM_DATABASE}.system_settings`,
      values: [
        {
          key: 'setup_completed',
          value: 'true',
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    // Create workspace database
    await rootClient.command({
      query: `CREATE DATABASE IF NOT EXISTS ${WORKSPACE_DATABASE}`,
    });

    // Create workspace tables
    for (const schema of Object.values(WORKSPACE_SCHEMAS)) {
      const query = schema.replace(/{database}/g, WORKSPACE_DATABASE);
      await rootClient.command({ query });
    }

    // Create workspace record in system database
    await rootClient.insert({
      table: `${SYSTEM_DATABASE}.workspaces`,
      values: [
        {
          id: WORKSPACE_ID,
          name: 'SDK E2E Test Workspace',
          website: 'http://localhost:3333',
          timezone: 'UTC',
          currency: 'USD',
          status: 'active',
          settings: JSON.stringify({
            timescore_reference: 60,
            bounce_threshold: 10,
            geo_enabled: false,
          }),
          created_at: now,
          updated_at: now,
        },
      ],
      format: 'JSONEachRow',
    });

    console.log(`SDK E2E test databases initialized: ${SYSTEM_DATABASE}, ${WORKSPACE_DATABASE}`);
  } finally {
    await rootClient.close();
  }
}

/**
 * Cleanup test databases
 * Called from global-teardown.ts
 */
export async function cleanupTestDatabases(): Promise<void> {
  // Close existing clients
  if (systemClient) {
    await systemClient.close();
    systemClient = null;
  }
  if (workspaceClient) {
    await workspaceClient.close();
    workspaceClient = null;
  }

  // Create a client without database for database dropping
  const rootClient = createClient({
    url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });

  try {
    await rootClient.command({
      query: `DROP DATABASE IF EXISTS ${SYSTEM_DATABASE}`,
    });
    await rootClient.command({
      query: `DROP DATABASE IF EXISTS ${WORKSPACE_DATABASE}`,
    });
    console.log(`SDK E2E test databases dropped: ${SYSTEM_DATABASE}, ${WORKSPACE_DATABASE}`);
  } finally {
    await rootClient.close();
  }
}

/**
 * Truncate events table (call between tests)
 */
export async function truncateEvents(): Promise<void> {
  const client = getWorkspaceClient();
  await client.command({ query: 'TRUNCATE TABLE events' });
  // Small delay for ClickHouse consistency
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Truncate all workspace tables (events, sessions, pages)
 */
export async function truncateWorkspaceTables(): Promise<void> {
  const client = getWorkspaceClient();
  await client.command({ query: 'TRUNCATE TABLE events' });
  await client.command({ query: 'TRUNCATE TABLE sessions' });
  await client.command({ query: 'TRUNCATE TABLE pages' });
  // Small delay for ClickHouse consistency
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Event record from ClickHouse
 */
export interface EventRecord {
  id: string;
  session_id: string;
  workspace_id: string;
  name: string;
  path: string;
  page_number: number;
  duration: number;
  max_scroll: number;
  device: string;
  browser: string;
  browser_type: string;
  os: string;
  user_agent: string;
  connection_type: string;
  language: string;
  timezone: string;
  landing_page: string;
  referrer: string;
  country: string;
  region: string;
  city: string;
  created_at: string;
  received_at: string;
  goal_name: string;
  goal_value: number;
  user_id: string | null;
  [key: string]: unknown;
}

/**
 * Query events from ClickHouse
 */
export async function queryEvents(sessionId?: string): Promise<EventRecord[]> {
  const client = getWorkspaceClient();

  const query = sessionId
    ? `SELECT * FROM events WHERE session_id = {sessionId:String} ORDER BY page_number, name`
    : `SELECT * FROM events ORDER BY received_at, page_number, name`;

  const result = await client.query({
    query,
    query_params: sessionId ? { sessionId } : {},
    format: 'JSONEachRow',
  });

  return result.json();
}

/**
 * Count events in database
 */
export async function countEvents(sessionId?: string): Promise<number> {
  const client = getWorkspaceClient();

  const query = sessionId
    ? `SELECT count() as cnt FROM events WHERE session_id = {sessionId:String}`
    : `SELECT count() as cnt FROM events`;

  const result = await client.query({
    query,
    query_params: sessionId ? { sessionId } : {},
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ cnt: string }[]>();
  return parseInt(rows[0]?.cnt || '0', 10);
}

/**
 * Wait for events to appear in ClickHouse
 * Polls until expected count is reached or timeout
 */
export async function waitForEvents(
  sessionId: string,
  expectedCount: number,
  timeoutMs: number = 10000,
  intervalMs: number = 200,
): Promise<EventRecord[]> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const count = await countEvents(sessionId);
    if (count >= expectedCount) {
      return queryEvents(sessionId);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // Return whatever we have even if count not reached
  const events = await queryEvents(sessionId);
  console.warn(
    `waitForEvents timeout: expected ${expectedCount} events for session ${sessionId}, got ${events.length}`,
  );
  return events;
}

/**
 * Get workspace ID used in tests
 */
export function getTestWorkspaceId(): string {
  return WORKSPACE_ID;
}

/**
 * Get workspace database name
 */
export function getTestWorkspaceDatabase(): string {
  return WORKSPACE_DATABASE;
}
