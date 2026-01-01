import { ClickHouseService } from '../../database/clickhouse.service';
import { BackfillTask } from './backfill-task.entity';
import { FilterDefinition } from '../entities/filter.entity';
import {
  compileFiltersToSQL,
  CompiledFilters,
} from '../lib/filter-compiler';

// Import type only to avoid circular dependency
import type { FilterBackfillService } from './backfill.service';

const EVENTS_TTL_DAYS = 7;
const MUTATION_CONCURRENCY_LIMIT = 50; // Buffer below ClickHouse's 100
const MUTATION_CAPACITY_POLL_MS = 500;
const MUTATION_CAPACITY_TIMEOUT_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function toClickHouseDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format date as partition name for events table (YYYYMMDD).
 */
function formatEventPartition(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format date as partition name for sessions table (YYYYMM).
 */
function formatSessionPartition(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
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
    const filters: FilterDefinition[] = JSON.parse(task.filters_snapshot);

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

    // Process each chunk
    for (const chunkDate of chunks) {
      if (this.cancelled) {
        break;
      }

      await this.processDateChunk(task, compiled, chunkDate);
    }
  }

  /**
   * Generate date chunks for the lookback period.
   */
  generateDateChunks(
    lookbackDays: number,
    chunkSizeDays: number,
    endDate: Date,
  ): Date[] {
    const chunks: Date[] = [];
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - lookbackDays + 1);

    let current = new Date(startDate);
    while (current <= endDate) {
      chunks.push(new Date(current));
      current.setDate(current.getDate() + chunkSizeDays);
    }

    return chunks;
  }

  /**
   * Check if a date is within the events TTL (7 days).
   */
  isWithinEventsTTL(date: Date): boolean {
    const now = new Date();
    const ttlBoundary = new Date(now);
    ttlBoundary.setDate(ttlBoundary.getDate() - EVENTS_TTL_DAYS);

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
         (SELECT count() FROM sessions WHERE created_at >= {start_date:DateTime64(3)}) as total_sessions,
         (SELECT count() FROM events WHERE created_at >= {start_date:DateTime64(3)}) as total_events`,
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
      eventsProcessed = await this.processEventsForDate(task, compiled, chunkDate);
    }

    // Then process sessions
    const sessionsProcessed = await this.processSessionsForDate(task, compiled, chunkDate);

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

    // Check mutation capacity before starting
    await this.ensureMutationCapacity(task.workspace_id);

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

      // Check mutation capacity before starting
      await this.ensureMutationCapacity(task.workspace_id);

      // Execute single mutation for entire partition
      // CRITICAL: Must update updated_at for ReplacingMergeTree deduplication
      // WHERE 1=1: Process all rows. ELSE ${dimension} in CASE prevents data loss.
      await this.clickhouse.commandWorkspaceWithParams(
        task.workspace_id,
        `ALTER TABLE sessions UPDATE
           ${setClause},
           updated_at = now64(3)
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
   * Ensure there is capacity for new mutations.
   * Waits if there are too many concurrent mutations running.
   */
  private async ensureMutationCapacity(workspaceId: string): Promise<void> {
    const dbName = this.clickhouse.getWorkspaceDatabaseName(workspaceId);
    const start = Date.now();

    while (Date.now() - start < MUTATION_CAPACITY_TIMEOUT_MS) {
      const result = await this.clickhouse.queryGlobal<{ count: string }>(
        `SELECT count() as count FROM system.mutations
         WHERE database = {db:String} AND is_done = 0`,
        { db: dbName },
      );

      if (parseInt(result[0]?.count ?? '0', 10) < MUTATION_CONCURRENCY_LIMIT) {
        return;
      }
      await sleep(MUTATION_CAPACITY_POLL_MS);
    }
    throw new Error('Timeout waiting for mutation capacity');
  }

  /**
   * Wait for all pending mutations on a table to complete.
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
  }
}
