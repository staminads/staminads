import { ClickHouseService } from '../../database/clickhouse.service';
import { BackfillTask } from './backfill-task.entity';
import { CustomDimensionDefinition } from '../entities/custom-dimension.entity';
import {
  computeCustomDimensions,
  extractFieldValues,
  CustomDimensionValues,
} from '../lib/rule-evaluator';

const EVENTS_TTL_DAYS = 7;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function toClickHouseDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export class BackfillProcessor {
  private cancelled = false;

  constructor(private readonly clickhouse: ClickHouseService) {}

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
   * Process a backfill task.
   */
  async process(task: BackfillTask): Promise<void> {
    const definitions: CustomDimensionDefinition[] = JSON.parse(
      task.dimensions_snapshot,
    );

    // Calculate date range
    const endDate = new Date();
    const chunks = this.generateDateChunks(
      task.lookback_days,
      task.chunk_size_days,
      endDate,
    );

    // Get total counts
    await this.updateTotalCounts(task);

    // Process each chunk
    for (const chunkDate of chunks) {
      if (this.cancelled) {
        break;
      }

      await this.processDateChunk(task, definitions, chunkDate);
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

    // Query workspace database for counts (no workspace_id filter needed)
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

      // Update task in system database
      await this.clickhouse.commandSystem(
        `ALTER TABLE backfill_tasks UPDATE
           total_sessions = ${parseInt(total_sessions, 10)},
           total_events = ${parseInt(total_events, 10)},
           started_at = now64(3),
           status = 'running'
         WHERE id = '${task.id}'`,
      );
    }
  }

  /**
   * Process a single date chunk.
   */
  async processDateChunk(
    task: BackfillTask,
    definitions: CustomDimensionDefinition[],
    chunkDate: Date,
  ): Promise<void> {
    const dateStr = toClickHouseDate(chunkDate);

    // Update current chunk in system database
    await this.clickhouse.commandSystem(
      `ALTER TABLE backfill_tasks UPDATE current_date_chunk = '${dateStr}' WHERE id = '${task.id}'`,
    );

    // Process events first (if within TTL)
    if (this.isWithinEventsTTL(chunkDate)) {
      await this.processEventsForDate(task, definitions, chunkDate);
    }

    // Then process sessions
    await this.processSessionsForDate(task, definitions, chunkDate);

    // Update progress
    await this.updateProgress(task.id);
  }

  /**
   * Process events for a specific date.
   */
  private async processEventsForDate(
    task: BackfillTask,
    definitions: CustomDimensionDefinition[],
    chunkDate: Date,
  ): Promise<void> {
    const dateStr = toClickHouseDate(chunkDate);
    let offset = 0;

    while (true) {
      if (this.cancelled) break;

      // Fetch batch of events from workspace database (no workspace_id filter)
      const events = await this.clickhouse.queryWorkspace<Record<string, unknown>>(
        task.workspace_id,
        `SELECT *
         FROM events
         WHERE toDate(created_at) = {date:Date}
         ORDER BY id
         LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        {
          date: dateStr,
          limit: task.batch_size,
          offset,
        },
      );

      if (events.length === 0) break;

      // Compute new CD values
      const updates = this.computeBatch(events, definitions);

      // Build and execute UPDATE query
      await this.updateEvents(task.workspace_id, updates);

      offset += events.length;

      if (events.length < task.batch_size) break;
    }
  }

  /**
   * Process sessions for a specific date.
   */
  private async processSessionsForDate(
    task: BackfillTask,
    definitions: CustomDimensionDefinition[],
    chunkDate: Date,
  ): Promise<void> {
    const dateStr = toClickHouseDate(chunkDate);
    let offset = 0;

    while (true) {
      if (this.cancelled) break;

      // Fetch batch of sessions from workspace database (no workspace_id filter)
      const sessions = await this.clickhouse.queryWorkspace<Record<string, unknown>>(
        task.workspace_id,
        `SELECT *
         FROM sessions FINAL
         WHERE toDate(created_at) = {date:Date}
         ORDER BY id
         LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        {
          date: dateStr,
          limit: task.batch_size,
          offset,
        },
      );

      if (sessions.length === 0) break;

      // Compute new CD values and merge with session data
      const updatedSessions = sessions.map((session) => {
        const fieldValues = extractFieldValues(session);
        const cdValues = computeCustomDimensions(definitions, fieldValues);

        return {
          ...session,
          ...cdValues,
          updated_at: toClickHouseDateTime(),
        };
      });

      // Insert updated sessions to workspace database (ReplacingMergeTree will deduplicate)
      await this.clickhouse.insertWorkspace(
        task.workspace_id,
        'sessions',
        updatedSessions,
      );

      offset += sessions.length;

      if (sessions.length < task.batch_size) break;
    }
  }

  /**
   * Update events with new CD values using ALTER UPDATE.
   */
  private async updateEvents(
    workspaceId: string,
    updates: Array<{ id: unknown } & CustomDimensionValues>,
  ): Promise<void> {
    if (updates.length === 0) return;

    // For batch updates, we use individual ALTER UPDATE per record
    // This is not optimal but simpler for now
    for (const update of updates) {
      const setClausesParts: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const cdKey = `cd_${i}` as keyof CustomDimensionValues;
        const versionKey = `cd_${i}_version` as keyof CustomDimensionValues;
        const cdValue = update[cdKey];
        const versionValue = update[versionKey];

        setClausesParts.push(
          `${cdKey} = ${cdValue === null ? 'NULL' : `'${cdValue}'`}`,
        );
        setClausesParts.push(
          `${versionKey} = ${versionValue === null ? 'NULL' : `'${versionValue}'`}`,
        );
      }

      // Execute on workspace database (no workspace_id in WHERE)
      await this.clickhouse.commandWorkspace(
        workspaceId,
        `ALTER TABLE events UPDATE ${setClausesParts.join(', ')}
         WHERE id = '${update.id}'`,
      );
    }

    // Wait for mutations to complete
    await this.waitForMutations(workspaceId);
  }

  /**
   * Wait for all pending mutations to complete.
   */
  private async waitForMutations(
    workspaceId: string,
    timeoutMs = 60000,
  ): Promise<void> {
    const start = Date.now();
    const dbName = this.clickhouse.getWorkspaceDatabaseName(workspaceId);

    while (Date.now() - start < timeoutMs) {
      // Query system.mutations for the workspace database
      const result = await this.clickhouse.queryWorkspace<{ is_done: number }>(
        workspaceId,
        `SELECT is_done FROM system.mutations
         WHERE database = '${dbName}'
         AND table = 'events'
         AND is_done = 0
         LIMIT 1`,
        {},
      );

      if (result.length === 0 || result[0].is_done === 1) {
        return;
      }

      await sleep(100);
    }
  }

  /**
   * Compute custom dimension values for a batch of records.
   */
  computeBatch(
    records: Record<string, unknown>[],
    definitions: CustomDimensionDefinition[],
  ): Array<{ id: unknown } & CustomDimensionValues> {
    return records.map((record) => {
      const fieldValues = extractFieldValues(record);
      const cdValues = computeCustomDimensions(definitions, fieldValues);

      return {
        id: record.id,
        ...cdValues,
      };
    });
  }

  /**
   * Update progress in the task record.
   */
  private async updateProgress(taskId: string): Promise<void> {
    // Get current counts from system database
    const result = await this.clickhouse.querySystem<{
      processed_sessions: string;
      processed_events: string;
    }>(
      `SELECT processed_sessions, processed_events FROM backfill_tasks WHERE id = {id:String}`,
      { id: taskId },
    );

    if (result.length > 0) {
      // Increment counts (simplified - in practice we'd track actual processed counts)
      await this.clickhouse.commandSystem(
        `ALTER TABLE backfill_tasks UPDATE
           processed_sessions = processed_sessions + 1,
           processed_events = processed_events + 1
         WHERE id = '${taskId}'`,
      );
    }
  }
}
