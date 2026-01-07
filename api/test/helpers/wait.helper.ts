/**
 * Wait/polling utilities for e2e tests
 *
 * Replaces hardcoded setTimeout delays with intelligent polling
 * for more reliable and faster tests.
 */

import { ClickHouseClient } from '@clickhouse/client';

export interface PollOptions {
  /** Maximum time to wait in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Interval between checks in milliseconds (default: 100) */
  intervalMs?: number;
  /** Behavior on timeout: 'throw' | 'warn' | 'silent' (default: 'throw') */
  onTimeout?: 'throw' | 'warn' | 'silent';
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_CLICKHOUSE_DELAY_MS = 100;

/**
 * Poll until a condition returns true.
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Polling options
 *
 * @example
 * await waitUntil(async () => {
 *   const result = await client.query({ query: 'SELECT count() FROM users' });
 *   const rows = await result.json();
 *   return rows[0].count > 0;
 * });
 */
export async function waitUntil(
  condition: () => Promise<boolean> | boolean,
  options: PollOptions = {},
): Promise<boolean> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    onTimeout = 'throw',
  } = options;

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await condition();
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (onTimeout === 'throw') {
    throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
  } else if (onTimeout === 'warn') {
    console.warn(`waitUntil timed out after ${timeoutMs}ms, continuing...`);
  }

  return false;
}

/**
 * Wait for a ClickHouse query to return expected row count.
 *
 * @param client - ClickHouse client
 * @param query - SQL query (should return a count)
 * @param expectedCount - Expected number of rows
 * @param params - Query parameters
 * @param options - Polling options
 *
 * @example
 * await waitForRowCount(
 *   systemClient,
 *   'SELECT count() as count FROM users WHERE email = {email:String}',
 *   1,
 *   { email: 'test@example.com' }
 * );
 */
export async function waitForRowCount(
  client: ClickHouseClient,
  query: string,
  expectedCount: number,
  params: Record<string, unknown> = {},
  options: PollOptions = {},
): Promise<void> {
  await waitUntil(async () => {
    const result = await client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    const count = Number(rows[0]?.count ?? 0);
    return count === expectedCount;
  }, options);
}

/**
 * Wait for all running backfill tasks to complete.
 *
 * @param client - ClickHouse client for system database
 * @param options - Polling options (default timeout: 10000ms)
 *
 * @example
 * await waitForBackfillsToComplete(systemClient);
 */
export async function waitForBackfillsToComplete(
  client: ClickHouseClient,
  options: PollOptions = {},
): Promise<void> {
  const opts = {
    timeoutMs: 10000,
    intervalMs: 100,
    onTimeout: 'warn' as const,
    ...options,
  };

  const success = await waitUntil(async () => {
    const result = await client.query({
      query: `SELECT count() as count FROM backfill_tasks FINAL
              WHERE status IN ('pending', 'running')`,
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    const count = parseInt(String(rows[0]?.count ?? '0'), 10);
    return count === 0;
  }, opts);

  if (!success) {
    console.warn(
      'Timeout waiting for backfills to complete, proceeding with cleanup',
    );
  }
}

/**
 * Wait for a specific task to reach a terminal state.
 *
 * @param client - ClickHouse client for system database
 * @param taskId - The task ID to monitor
 * @param options - Polling options
 * @returns The final status of the task
 *
 * @example
 * const status = await waitForTaskCompletion(systemClient, taskId);
 * expect(status).toBe('completed');
 */
export async function waitForTaskCompletion(
  client: ClickHouseClient,
  taskId: string,
  options: PollOptions = {},
): Promise<string> {
  const terminalStatuses = ['completed', 'failed', 'cancelled'];
  let finalStatus = 'unknown';

  await waitUntil(async () => {
    const result = await client.query({
      query: `SELECT status FROM backfill_tasks FINAL WHERE id = {taskId:String}`,
      query_params: { taskId },
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    const status = rows[0]?.status;

    if (status && terminalStatuses.includes(status)) {
      finalStatus = status;
      return true;
    }
    return false;
  }, options);

  return finalStatus;
}

/**
 * Wait for ClickHouse mutations to complete.
 * Useful after DELETE/ALTER TABLE operations.
 *
 * @param client - ClickHouse client
 * @param database - Database name to check mutations for
 * @param options - Polling options
 *
 * @example
 * await systemClient.command({ query: 'ALTER TABLE users DELETE WHERE ...' });
 * await waitForMutations(systemClient, 'staminads_test_system');
 */
export async function waitForMutations(
  client: ClickHouseClient,
  database: string,
  options: PollOptions = {},
): Promise<void> {
  const opts = {
    timeoutMs: 5000,
    intervalMs: 100,
    onTimeout: 'warn' as const,
    ...options,
  };

  await waitUntil(async () => {
    const result = await client.query({
      query: `SELECT count() as count FROM system.mutations
              WHERE database = {database:String} AND is_done = 0`,
      query_params: { database },
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    const count = parseInt(String(rows[0]?.count ?? '0'), 10);
    return count === 0;
  }, opts);
}

/**
 * Simple delay for ClickHouse eventual consistency.
 * Use only when polling is not feasible.
 *
 * @param delayMs - Delay in milliseconds (default: 100ms)
 *
 * @example
 * await systemClient.insert({ table: 'users', values: [...] });
 * await waitForClickHouse(); // Wait for write to be visible
 */
export async function waitForClickHouse(
  delayMs: number = DEFAULT_CLICKHOUSE_DELAY_MS,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Wait for data to appear in a table.
 *
 * @param client - ClickHouse client
 * @param table - Table name
 * @param whereClause - WHERE clause conditions
 * @param params - Query parameters
 * @param options - Polling options
 *
 * @example
 * await waitForData(systemClient, 'users', 'email = {email:String}', { email: 'test@example.com' });
 */
export async function waitForData(
  client: ClickHouseClient,
  table: string,
  whereClause: string,
  params: Record<string, unknown> = {},
  options: PollOptions = {},
): Promise<void> {
  await waitForRowCount(
    client,
    `SELECT count() as count FROM ${table} FINAL WHERE ${whereClause}`,
    1,
    params,
    { timeoutMs: 5000, ...options },
  );
}

/**
 * Wait for table to be empty (useful after truncation).
 *
 * @param client - ClickHouse client
 * @param table - Table name
 * @param options - Polling options
 *
 * @example
 * await systemClient.command({ query: 'TRUNCATE TABLE users' });
 * await waitForEmpty(systemClient, 'users');
 */
export async function waitForEmpty(
  client: ClickHouseClient,
  table: string,
  options: PollOptions = {},
): Promise<void> {
  await waitForRowCount(
    client,
    `SELECT count() as count FROM ${table}`,
    0,
    {},
    { timeoutMs: 5000, ...options },
  );
}
