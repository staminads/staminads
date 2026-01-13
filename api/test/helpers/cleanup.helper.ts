/**
 * Cleanup helper functions for e2e tests
 *
 * Provides utilities for truncating tables and cleaning up test data.
 * Ensures consistent test isolation across all test files.
 */

import { ClickHouseClient } from '@clickhouse/client';

/**
 * Default delay after truncation to allow ClickHouse to process
 */
const DEFAULT_DELAY_MS = 100;

/**
 * System database tables that can be truncated
 */
export type SystemTable =
  | 'users'
  | 'workspaces'
  | 'workspace_memberships'
  | 'invitations'
  | 'api_keys'
  | 'backfill_tasks'
  | 'sessions'
  | 'audit_logs'
  | 'password_reset_tokens'
  | 'system_settings'
  | 'report_subscriptions';

/**
 * Workspace database tables that can be truncated
 */
export type WorkspaceTable = 'sessions' | 'events';

/**
 * Truncate a single table
 *
 * @param client - ClickHouse client
 * @param table - Table name
 */
async function truncateTable(
  client: ClickHouseClient,
  table: string,
): Promise<void> {
  await client.command({ query: `TRUNCATE TABLE ${table}` });
}

/**
 * Truncate multiple tables in the system database
 *
 * @param client - ClickHouse client for system database
 * @param tables - Tables to truncate
 * @param delayMs - Delay after truncation (default: 100ms)
 *
 * @example
 * await truncateSystemTables(systemClient, ['users', 'workspaces']);
 */
export async function truncateSystemTables(
  client: ClickHouseClient,
  tables: SystemTable[],
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<void> {
  for (const table of tables) {
    await truncateTable(client, table);
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Truncate multiple tables in a workspace database
 *
 * @param client - ClickHouse client for workspace database
 * @param tables - Tables to truncate
 * @param delayMs - Delay after truncation (default: 100ms)
 *
 * @example
 * await truncateWorkspaceTables(workspaceClient, ['sessions', 'events']);
 */
export async function truncateWorkspaceTables(
  client: ClickHouseClient,
  tables: WorkspaceTable[],
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<void> {
  for (const table of tables) {
    await truncateTable(client, table);
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Clean all common system tables (users, workspaces, memberships, invitations)
 *
 * @param client - ClickHouse client for system database
 * @param delayMs - Delay after truncation (default: 100ms)
 *
 * @example
 * beforeEach(async () => {
 *   await cleanupSystemTables(systemClient);
 * });
 */
export async function cleanupSystemTables(
  client: ClickHouseClient,
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<void> {
  await truncateSystemTables(
    client,
    ['workspaces', 'users', 'workspace_memberships', 'invitations'],
    delayMs,
  );
}

/**
 * Clean all workspace tables (sessions, events)
 *
 * @param client - ClickHouse client for workspace database
 * @param delayMs - Delay after truncation (default: 100ms)
 *
 * @example
 * beforeEach(async () => {
 *   await cleanupWorkspaceTables(workspaceClient);
 * });
 */
export async function cleanupWorkspaceTables(
  client: ClickHouseClient,
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<void> {
  await truncateWorkspaceTables(client, ['sessions', 'events'], delayMs);
}

/**
 * Full cleanup of both system and workspace tables
 *
 * @param systemClient - ClickHouse client for system database
 * @param workspaceClient - ClickHouse client for workspace database (optional)
 * @param options - Cleanup options
 *
 * @example
 * beforeEach(async () => {
 *   await fullCleanup(systemClient, workspaceClient);
 * });
 */
export async function fullCleanup(
  systemClient: ClickHouseClient,
  workspaceClient?: ClickHouseClient,
  options: {
    systemTables?: SystemTable[];
    workspaceTables?: WorkspaceTable[];
    delayMs?: number;
  } = {},
): Promise<void> {
  const systemTables = options.systemTables || [
    'workspaces',
    'users',
    'workspace_memberships',
    'invitations',
    'api_keys',
  ];
  const workspaceTables = options.workspaceTables || ['sessions', 'events'];
  const delayMs = options.delayMs || DEFAULT_DELAY_MS;

  await truncateSystemTables(systemClient, systemTables, 0);

  if (workspaceClient) {
    await truncateWorkspaceTables(workspaceClient, workspaceTables, 0);
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Note: waitForClickHouse is exported from wait.helper.ts
// Use: import { waitForClickHouse } from './helpers';
