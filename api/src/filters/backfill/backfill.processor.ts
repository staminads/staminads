import { Semaphore } from 'async-mutex';
import { ClickHouseService } from '../../database/clickhouse.service';
import { BackfillTask } from './backfill-task.entity';
import { FilterDefinition } from '../entities/filter.entity';
import { compileFiltersToSQL, CompiledFilters } from '../lib/filter-compiler';

// Import type only to avoid circular dependency
import type { FilterBackfillService } from './backfill.service';
import { toClickHouseDateTime } from '../../common/utils/datetime.util';

const EVENTS_TTL_DAYS = 7;

// Global semaphore for mutation capacity coordination across all backfill processors
// Soft limit: 80 concurrent mutations (gates burst submission, not total capacity)
const GLOBAL_MUTATION_SEMAPHORE = new Semaphore(80);
// Hard limit: ClickHouse's actual capacity (leave headroom for system mutations)
const CLICKHOUSE_HARD_LIMIT = 95;
// Timeout for acquiring a semaphore slot
const SEMAPHORE_TIMEOUT_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toClickHouseDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format date as partition name for events table (YYYYMMDD).
 * Uses UTC to match ClickHouse's toYYYYMMDD(created_at) partitioning.
 */
function formatEventPartition(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format date as partition name for sessions table (YYYYMM).
 * Uses UTC to match ClickHouse's toYYYYMM(created_at) partitioning.
 */
function formatSessionPartition(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

export class FilterBackfillProcessor {
  private cancelled = false;
  private processedSessionPartitions = new Set<string>();

  /**
   * Static lock map to prevent concurrent backfills on the same workspace.
   * Key: workspace_id, Value: Promise that resolves when backfill completes.
   */
  private static workspaceLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly backfillService: FilterBackfillService,
  ) {}

  /**
   * Check if the processor has been cancelled.
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Cancel the processor. Processing will stop at the next chunk.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Kill all pending mutations for a workspace.
   * Best effort - doesn't throw on failure.
   */
  async killWorkspaceMutations(workspaceId: string): Promise<void> {
    const dbName = this.clickhouse.getWorkspaceDatabaseName(workspaceId);
    try {
      await this.clickhouse.commandGlobal(
        `KILL MUTATION WHERE database = '${dbName}' AND is_done = 0`,
      );
    } catch (error) {
      console.warn(
        `Failed to kill mutations for workspace ${workspaceId}:`,
        error,
      );
      // Best effort - don't throw
    }
  }

  /**
   * Check if a regex pattern uses features unsupported by RE2 (ClickHouse's regex engine).
   * RE2 doesn't support lookahead/lookbehind assertions.
   */
  private hasUnsupportedRE2Features(pattern: string): boolean {
    // RE2 doesn't support lookahead (?=, (?!) or lookbehind (?<, (?<!)
    return /\(\?[=!<]/.test(pattern);
  }

  /**
   * Validate all filters before backfill processing.
   * Catches issues that would cause mutations to fail partway through.
   * @throws Error if any filter is invalid
   */
  private validateFiltersForBackfill(filters: FilterDefinition[]): void {
    const errors: string[] = [];

    for (const filter of filters) {
      // Skip disabled filters
      if (!filter.enabled) continue;

      // Validate each condition
      for (const condition of filter.conditions) {
        // Validate field names exist
        if (!condition.field || condition.field.trim() === '') {
          errors.push(
            `Filter "${filter.name}" (${filter.id}): Empty field name in condition`,
          );
        }

        // Validate regex patterns
        if (condition.operator === 'regex') {
          const regexValue = condition.value ?? '';
          // Test JavaScript regex compilation
          try {
            new RegExp(regexValue);
          } catch (e) {
            errors.push(
              `Filter "${filter.name}" (${filter.id}): Invalid regex pattern "${regexValue}" - ${e instanceof Error ? e.message : 'unknown error'}`,
            );
          }

          // Check RE2 compatibility (ClickHouse uses RE2)
          if (this.hasUnsupportedRE2Features(regexValue)) {
            errors.push(
              `Filter "${filter.name}" (${filter.id}): Regex pattern uses lookahead/lookbehind, not supported by ClickHouse RE2`,
            );
          }
        }
      }

      // Validate operations
      for (const operation of filter.operations) {
        if (!operation.dimension || operation.dimension.trim() === '') {
          errors.push(
            `Filter "${filter.name}" (${filter.id}): Empty dimension in operation`,
          );
        }

        // Validate value is present for set_value and set_default_value
        if (
          (operation.action === 'set_value' ||
            operation.action === 'set_default_value') &&
          (operation.value === undefined || operation.value === null)
        ) {
          errors.push(
            `Filter "${filter.name}" (${filter.id}): Missing value for ${operation.action} on ${operation.dimension}`,
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Filter validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Process a backfill task with workspace-level locking.
   * Prevents concurrent backfills on the same workspace.
   */
  async process(task: BackfillTask): Promise<void> {
    const lockKey = task.workspace_id;

    // Wait for any existing backfill on this workspace to complete
    const existingLock = FilterBackfillProcessor.workspaceLocks.get(lockKey);
    if (existingLock) {
      await existingLock;
    }

    // Create our lock
    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    FilterBackfillProcessor.workspaceLocks.set(lockKey, lockPromise);

    try {
      await this.processInternal(task);
    } finally {
      releaseLock();
      FilterBackfillProcessor.workspaceLocks.delete(lockKey);
    }
  }

  /**
   * Internal processing logic.
   */
  private async processInternal(task: BackfillTask): Promise<void> {
    // Parse filters from snapshot
    let filters: FilterDefinition[];
    try {
      filters = JSON.parse(task.filters_snapshot);
    } catch (error) {
      throw new Error(
        `Invalid filters_snapshot: ${error instanceof Error ? error.message : 'parse error'}`,
      );
    }

    // Validate filters before any mutations
    this.validateFiltersForBackfill(filters);

    // Compile filters to SQL once (deterministic, no need to recompile per chunk)
    const compiled = compileFiltersToSQL(filters);

    // Reset session partition tracking for this task
    this.processedSessionPartitions.clear();

    // Calculate date range
    const endDate = new Date();
    const chunks = this.generateDateChunks(
      task.lookback_days,
      task.chunk_size_days,
      endDate,
    );

    // Get total counts and mark as running
    await this.updateTotalCounts(task);

    // Process each chunk - kill mutations on any error
    try {
      for (const chunkDate of chunks) {
        if (this.cancelled) {
          break;
        }

        try {
          await this.processDateChunk(task, compiled, chunkDate);
        } catch (error) {
          const dateStr = toClickHouseDate(chunkDate);
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed processing chunk ${dateStr}: ${msg}`);
        }
      }
    } catch (error) {
      // Kill any pending mutations before propagating the error
      await this.killWorkspaceMutations(task.workspace_id);
      throw error;
    }
  }

  /**
   * Generate date chunks for the lookback period.
   * Uses UTC to match ClickHouse partitioning.
   */
  generateDateChunks(
    lookbackDays: number,
    chunkSizeDays: number,
    endDate: Date,
  ): Date[] {
    const chunks: Date[] = [];

    // Normalize to UTC midnight
    const endUTC = new Date(
      Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate(),
      ),
    );

    const startUTC = new Date(endUTC);
    startUTC.setUTCDate(startUTC.getUTCDate() - lookbackDays + 1);

    const current = new Date(startUTC);
    while (current <= endUTC) {
      chunks.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + chunkSizeDays);
    }

    return chunks;
  }

  /**
   * Check if a date is within the events TTL (7 days).
   * Uses UTC for consistency with partition key generation.
   */
  isWithinEventsTTL(date: Date): boolean {
    const now = new Date();
    const ttlBoundary = new Date(now);
    ttlBoundary.setUTCDate(ttlBoundary.getUTCDate() - EVENTS_TTL_DAYS);

    return date >= ttlBoundary;
  }

  /**
   * Update total counts for progress tracking.
   */
  private async updateTotalCounts(task: BackfillTask): Promise<void> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - task.lookback_days);

    // Query workspace database for counts
    const result = await this.clickhouse.queryWorkspace<{
      total_sessions: string;
      total_events: string;
    }>(
      task.workspace_id,
      `SELECT
         (SELECT count() FROM sessions WHERE created_at >= toDateTime64({start_date:String}, 3)) as total_sessions,
         (SELECT count() FROM events WHERE created_at >= toDateTime64({start_date:String}, 3)) as total_events`,
      {
        start_date: toClickHouseDateTime(startDate),
      },
    );

    if (result.length > 0) {
      const { total_sessions, total_events } = result[0];

      // Update task using service (INSERT pattern for ReplacingMergeTree)
      await this.backfillService.updateTaskProgress(task, {
        total_sessions: parseInt(total_sessions, 10),
        total_events: parseInt(total_events, 10),
        started_at: toClickHouseDateTime(),
        status: 'running',
      });
    }
  }

  /**
   * Process a single date chunk.
   */
  async processDateChunk(
    task: BackfillTask,
    compiled: CompiledFilters,
    chunkDate: Date,
  ): Promise<void> {
    const dateStr = toClickHouseDate(chunkDate);

    // Update current chunk using service
    await this.backfillService.updateTaskProgress(task, {
      current_date_chunk: dateStr,
    });

    // Process events first (if within TTL)
    let eventsProcessed = 0;
    if (this.isWithinEventsTTL(chunkDate)) {
      eventsProcessed = await this.processEventsForDate(
        task,
        compiled,
        chunkDate,
      );
    }

    // Then process sessions
    const sessionsProcessed = await this.processSessionsForDate(
      task,
      compiled,
      chunkDate,
    );

    // Update progress with actual counts
    await this.backfillService.updateTaskProgress(task, {
      processed_sessions: task.processed_sessions + sessionsProcessed,
      processed_events: task.processed_events + eventsProcessed,
    });
  }

  /**
   * Process events for a specific date using SQL-compiled filters.
   * Executes a single partition-based mutation instead of fetching/updating IDs.
   * Returns the number of events in the partition.
   */
  private async processEventsForDate(
    task: BackfillTask,
    compiled: CompiledFilters,
    chunkDate: Date,
  ): Promise<number> {
    const { setClause } = compiled;

    // Format partition name (YYYYMMDD for events)
    const partition = formatEventPartition(chunkDate);

    // Acquire mutation slot (semaphore released immediately after check)
    await this.acquireMutationSlot();

    // Execute single mutation for entire partition
    // WHERE 1=1: Process all rows. ELSE ${dimension} in CASE prevents data loss.
    await this.clickhouse.commandWorkspaceWithParams(
      task.workspace_id,
      `ALTER TABLE events UPDATE
         ${setClause}
       IN PARTITION '${partition}'
       WHERE 1=1`,
      {},
    );

    // Wait for mutation to complete
    await this.waitForMutations(task.workspace_id, 'events');

    // Get count for progress tracking
    const result = await this.clickhouse.queryWorkspace<{ count: string }>(
      task.workspace_id,
      `SELECT count() as count FROM events
       WHERE toYYYYMMDD(created_at) = {partition:UInt32}`,
      { partition: parseInt(partition, 10) },
    );

    return parseInt(result[0]?.count ?? '0', 10);
  }

  /**
   * Process sessions for a specific date using SQL-compiled filters.
   * Sessions use ReplacingMergeTree(updated_at), so we must update updated_at.
   * Sessions use monthly partitions, so we deduplicate to avoid redundant mutations.
   * Returns the number of sessions for this date (for progress tracking).
   */
  private async processSessionsForDate(
    task: BackfillTask,
    compiled: CompiledFilters,
    chunkDate: Date,
  ): Promise<number> {
    // Format partition name (YYYYMM for sessions - monthly partitions)
    const partition = formatSessionPartition(chunkDate);

    // Check if this partition was already processed (sessions use monthly partitions)
    // Multiple dates in the same month would otherwise trigger redundant mutations
    if (!this.processedSessionPartitions.has(partition)) {
      const { setClause } = compiled;

      // Acquire mutation slot (semaphore released immediately after check)
      await this.acquireMutationSlot();

      // Execute single mutation for entire partition
      // Note: Cannot update updated_at (ReplacingMergeTree version column)
      // WHERE 1=1: Process all rows. ELSE ${dimension} in CASE prevents data loss.
      await this.clickhouse.commandWorkspaceWithParams(
        task.workspace_id,
        `ALTER TABLE sessions UPDATE
           ${setClause}
         IN PARTITION '${partition}'
         WHERE 1=1`,
        {},
      );

      // Wait for mutation to complete
      await this.waitForMutations(task.workspace_id, 'sessions');

      // Mark partition as processed
      this.processedSessionPartitions.add(partition);
    }

    // Always get count for progress tracking (per-date, not per-partition)
    const dateStr = toClickHouseDate(chunkDate);
    const result = await this.clickhouse.queryWorkspace<{ count: string }>(
      task.workspace_id,
      `SELECT count() as count FROM sessions FINAL
       WHERE toDate(created_at) = {date:Date}`,
      { date: dateStr },
    );

    return parseInt(result[0]?.count ?? '0', 10);
  }

  /**
   * Get the global count of running mutations across ALL databases.
   * Used to check ClickHouse's overall mutation capacity.
   */
  private async getGlobalMutationCount(): Promise<number> {
    const result = await this.clickhouse.queryGlobal<{ count: string }>(
      `SELECT count() as count FROM system.mutations WHERE is_done = 0`,
      {},
    );
    return parseInt(result[0]?.count ?? '0', 10);
  }

  /**
   * Acquire a mutation slot using global semaphore coordination.
   *
   * Design (per Gemini review):
   * - Semaphore gates SUBMISSION burst, not total capacity
   * - Release semaphore IMMEDIATELY after check (don't hold during mutation execution)
   * - Pre-check and post-check ClickHouse capacity for fail-fast and race protection
   *
   * @throws Error if ClickHouse is overloaded or timeout acquiring slot
   */
  private async acquireMutationSlot(): Promise<void> {
    // Pre-check: fail fast if ClickHouse is already overloaded
    const preCheck = await this.getGlobalMutationCount();
    if (preCheck >= CLICKHOUSE_HARD_LIMIT) {
      throw new Error(
        `ClickHouse mutation queue full (${preCheck}/${CLICKHOUSE_HARD_LIMIT})`,
      );
    }

    // Acquire semaphore with timeout
    const acquirePromise = GLOBAL_MUTATION_SEMAPHORE.acquire();
    const timeoutPromise = sleep(SEMAPHORE_TIMEOUT_MS).then(() => {
      throw new Error('Timeout acquiring mutation slot');
    });

    const [, release] = await Promise.race([acquirePromise, timeoutPromise]);

    try {
      // Double-check after acquiring (race protection)
      const postCheck = await this.getGlobalMutationCount();
      if (postCheck >= CLICKHOUSE_HARD_LIMIT) {
        throw new Error(
          `ClickHouse mutation queue full (${postCheck}/${CLICKHOUSE_HARD_LIMIT})`,
        );
      }
    } finally {
      // Release semaphore IMMEDIATELY - don't hold during mutation execution
      // This allows other processors to submit while this mutation runs
      release();
    }
  }

  /**
   * Wait for all pending mutations on a table to complete.
   * Kills mutations and throws on timeout.
   */
  private async waitForMutations(
    workspaceId: string,
    table: 'events' | 'sessions',
    timeoutMs = 60000,
  ): Promise<void> {
    const start = Date.now();
    const dbName = this.clickhouse.getWorkspaceDatabaseName(workspaceId);

    while (Date.now() - start < timeoutMs) {
      // Query system.mutations directly (global system table, not workspace table)
      const result = await this.clickhouse.queryGlobal<{ is_done: number }>(
        `SELECT is_done FROM system.mutations
         WHERE database = {db:String}
         AND table = {table:String}
         AND is_done = 0
         LIMIT 1`,
        { db: dbName, table },
      );

      if (result.length === 0 || result[0].is_done === 1) {
        return;
      }

      await sleep(100);
    }

    // Timeout: kill mutations before throwing
    await this.killWorkspaceMutations(workspaceId);
    throw new Error(`Timeout waiting for ${table} mutations to complete`);
  }
}
