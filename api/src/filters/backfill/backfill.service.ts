import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { ClickHouseService } from '../../database/clickhouse.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { StartBackfillDto } from './dto/start-backfill.dto';
import {
  BackfillSuccessResponseDto,
  BackfillStartResponseDto,
} from './dto/backfill-response.dto';
import { BackfillTask, BackfillTaskProgress } from './backfill-task.entity';
import { FilterBackfillProcessor } from './backfill.processor';
import { FilterDefinition } from '../entities/filter.entity';
import { computeFilterVersion } from '../lib/filter-evaluator';
import { toClickHouseDateTime } from '../../common/utils/datetime.util';

export interface BackfillSummary {
  needsBackfill: boolean;
  currentFilterVersion: string;
  lastCompletedFilterVersion: string | null;
  activeTask: BackfillTaskProgress | null;
}

@Injectable()
export class FilterBackfillService implements OnModuleInit, OnModuleDestroy {
  private runningProcessors = new Map<string, FilterBackfillProcessor>();
  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly staleThresholdMinutes = parseInt(
    process.env.BACKFILL_STALE_THRESHOLD_MINUTES || '5',
    10,
  );

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * On module init, recover any stale tasks that were left running.
   */
  async onModuleInit(): Promise<void> {
    await this.recoverStaleTasks();
  }

  /**
   * On module destroy, gracefully cancel running tasks and kill mutations.
   */
  async onModuleDestroy(): Promise<void> {
    // Clear all pending timeouts first
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.clear();

    if (this.runningProcessors.size === 0) return;

    console.log(
      `Shutting down: cancelling ${this.runningProcessors.size} running backfill(s)...`,
    );

    // First, cancel all processors and kill their mutations
    const killPromises: Promise<void>[] = [];
    for (const [taskId, processor] of this.runningProcessors.entries()) {
      processor.cancel();

      // Query task to get workspace_id for mutation killing
      this.clickhouse
        .querySystem<BackfillTask>(
          `SELECT * FROM backfill_tasks FINAL WHERE id = {id:String}`,
          { id: taskId },
        )
        .then((tasks) => {
          if (tasks.length > 0) {
            killPromises.push(
              processor.killWorkspaceMutations(tasks[0].workspace_id),
            );
          }
        })
        .catch((error) => {
          console.warn(
            `Failed to get task ${taskId} for mutation cleanup:`,
            error,
          );
        });
    }

    // Wait for kill operations (with timeout)
    await Promise.race([
      Promise.all(killPromises),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);

    // Update task statuses
    for (const [taskId] of this.runningProcessors.entries()) {
      try {
        const tasks = await this.clickhouse.querySystem<BackfillTask>(
          `SELECT * FROM backfill_tasks FINAL WHERE id = {id:String}`,
          { id: taskId },
        );
        if (tasks.length > 0 && tasks[0].status === 'running') {
          await this.updateTaskStatus(
            tasks[0],
            'cancelled',
            'Service shutdown',
          );
        }
      } catch (error) {
        console.warn(`Failed to cancel task ${taskId} on shutdown:`, error);
      }
    }
  }

  /**
   * Recover stale tasks that were left in 'running' status.
   * Only recovers tasks older than the stale threshold to avoid race conditions.
   */
  private async recoverStaleTasks(): Promise<void> {
    // Wait for any in-flight startBackfill() calls to complete
    await new Promise((r) => setTimeout(r, 2000));

    const staleTasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks FINAL
       WHERE status = 'running'
       AND updated_at < now() - INTERVAL {threshold:UInt32} MINUTE`,
      { threshold: this.staleThresholdMinutes },
    );

    for (const task of staleTasks) {
      console.warn(
        `Recovering stale backfill task ${task.id} (workspace: ${task.workspace_id}, last updated: ${task.updated_at})`,
      );
      await this.updateTaskStatus(
        task,
        'failed',
        'Task stale - recovered on service restart',
      );
    }

    if (staleTasks.length > 0) {
      console.log(`Recovered ${staleTasks.length} stale backfill task(s)`);
    }
  }

  /**
   * Start a new backfill task for a workspace.
   * Returns immediately with a task_id for polling.
   */
  async startBackfill(
    dto: StartBackfillDto,
  ): Promise<BackfillStartResponseDto> {
    // Validate workspace exists
    const workspace = await this.workspacesService.get(dto.workspace_id);

    // Check for running tasks in system database (use FINAL for ReplacingMergeTree)
    const runningTasks = await this.clickhouse.querySystem<{ id: string }>(
      `SELECT id FROM backfill_tasks FINAL
       WHERE workspace_id = {workspace_id:String}
       AND status IN ('pending', 'running')
       LIMIT 1`,
      { workspace_id: dto.workspace_id },
    );

    if (runningTasks.length > 0) {
      throw new ConflictException(
        `Backfill already in progress: ${runningTasks[0].id}`,
      );
    }

    // Create task with filters snapshot
    const taskId = randomUUID();
    const now = toClickHouseDateTime();

    const task: BackfillTask = {
      id: taskId,
      workspace_id: dto.workspace_id,
      status: 'pending',
      lookback_days: dto.lookback_days,
      chunk_size_days: dto.chunk_size_days ?? 1,
      batch_size: dto.batch_size ?? 5000,
      total_sessions: 0,
      processed_sessions: 0,
      total_events: 0,
      processed_events: 0,
      current_date_chunk: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
      error_message: null,
      retry_count: 0,
      filters_snapshot: JSON.stringify(workspace.settings.filters ?? []),
    };

    await this.clickhouse.insertSystem('backfill_tasks', [task]);

    // Spawn processor asynchronously
    const timeoutHandle = setTimeout(async () => {
      this.pendingTimeouts.delete(timeoutHandle);
      const processor = new FilterBackfillProcessor(this.clickhouse, this);
      this.runningProcessors.set(taskId, processor);
      const startTime = Date.now();
      let finalStatus: 'completed' | 'failed' | 'cancelled' = 'failed';

      try {
        await processor.process(task);
        if (!processor.isCancelled()) {
          await this.updateTaskStatusWithRetry(task, 'completed');
          this.eventEmitter.emit('backfill.completed', {
            workspaceId: task.workspace_id,
          });
          finalStatus = 'completed';
        } else {
          await this.updateTaskStatusWithRetry(task, 'cancelled');
          finalStatus = 'cancelled';
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(`Backfill task ${task.id} failed:`, errorMsg);
        // Only strip control chars, keep useful chars like @, ., /
        const sanitizedError =
          errorMsg
            .slice(0, 200)
            .replace(/[\x00-\x1F\x7F]/g, '')
            .trim() || 'Unknown error';
        try {
          await this.updateTaskStatusWithRetry(task, 'failed', sanitizedError);
        } catch (statusError) {
          // Last resort: log critical error. Stale recovery will handle on restart.
          console.error('CRITICAL: Cannot update task status after retries', {
            taskId: task.id,
            workspaceId: task.workspace_id,
            originalError: sanitizedError,
            statusError:
              statusError instanceof Error ? statusError.message : statusError,
          });
        }
        finalStatus = 'failed';
      } finally {
        // Metrics logging
        console.log('Backfill task finished', {
          taskId: task.id,
          workspaceId: task.workspace_id,
          status: finalStatus,
          durationMs: Date.now() - startTime,
          sessionsProcessed: task.processed_sessions,
          eventsProcessed: task.processed_events,
        });
        this.runningProcessors.delete(taskId);
      }
    }, 0);
    this.pendingTimeouts.add(timeoutHandle);

    return { task_id: taskId };
  }

  /**
   * Update task status by inserting a new row (ReplacingMergeTree pattern).
   * The new row with higher updated_at will replace the old one.
   */
  async updateTaskStatus(
    task: BackfillTask,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ): Promise<void> {
    const now = toClickHouseDateTime();
    const updatedTask: BackfillTask = {
      ...task,
      status,
      updated_at: now,
      completed_at:
        status === 'completed' || status === 'failed' || status === 'cancelled'
          ? now
          : task.completed_at,
      error_message: errorMessage ?? task.error_message,
    };
    await this.clickhouse.insertSystem('backfill_tasks', [updatedTask]);
  }

  /**
   * Update task status with retry logic and exponential backoff.
   * Throws after exhausting retries - caller must handle the failure.
   */
  async updateTaskStatusWithRetry(
    task: BackfillTask,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
    maxRetries = 5,
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.updateTaskStatus(task, status, errorMessage);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(
          `Status update attempt ${attempt}/${maxRetries} failed for task ${task.id}: ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          await new Promise((r) =>
            setTimeout(r, 1000 * Math.pow(2, attempt - 1)),
          );
        }
      }
    }

    // Throw after exhausting retries - caller must handle
    throw new Error(
      `Failed to update task ${task.id} to '${status}' after ${maxRetries} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Update task progress by inserting a new row (ReplacingMergeTree pattern).
   */
  async updateTaskProgress(
    task: BackfillTask,
    updates: Partial<
      Pick<
        BackfillTask,
        | 'total_sessions'
        | 'processed_sessions'
        | 'total_events'
        | 'processed_events'
        | 'current_date_chunk'
        | 'started_at'
        | 'status'
      >
    >,
  ): Promise<void> {
    const now = toClickHouseDateTime();
    const updatedTask: BackfillTask = {
      ...task,
      ...updates,
      updated_at: now,
    };
    await this.clickhouse.insertSystem('backfill_tasks', [updatedTask]);
    // Update the task reference for subsequent updates
    Object.assign(task, updatedTask);
  }

  /**
   * Get the status and progress of a backfill task.
   */
  async getTaskStatus(taskId: string): Promise<BackfillTaskProgress> {
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks FINAL WHERE id = {id:String}`,
      { id: taskId },
    );

    if (tasks.length === 0) {
      throw new NotFoundException(`Backfill task ${taskId} not found`);
    }

    return this.toProgress(tasks[0]);
  }

  /**
   * Cancel a running backfill task.
   */
  async cancelTask(taskId: string): Promise<BackfillSuccessResponseDto> {
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks FINAL WHERE id = {id:String}`,
      { id: taskId },
    );

    if (tasks.length === 0) {
      throw new NotFoundException(`Backfill task ${taskId} not found`);
    }

    const task = tasks[0];

    if (task.status === 'completed') {
      throw new BadRequestException('Cannot cancel a completed task');
    }

    if (task.status === 'cancelled') {
      throw new BadRequestException('Task is already cancelled');
    }

    if (task.status === 'failed') {
      throw new BadRequestException('Cannot cancel a failed task');
    }

    // Cancel running processor if exists
    const processor = this.runningProcessors.get(taskId);
    if (processor) {
      processor.cancel();
      // Kill any active mutations immediately
      await processor.killWorkspaceMutations(task.workspace_id);
    }

    // Insert new row with cancelled status (ReplacingMergeTree will deduplicate)
    await this.updateTaskStatus(task, 'cancelled');

    return { success: true };
  }

  /**
   * List all backfill tasks for a workspace.
   */
  async listTasks(workspaceId: string): Promise<BackfillTaskProgress[]> {
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks FINAL
       WHERE workspace_id = {workspace_id:String}
       ORDER BY created_at DESC`,
      { workspace_id: workspaceId },
    );

    return tasks.map((task) => this.toProgress(task));
  }

  /**
   * Get backfill summary for a workspace.
   * Returns whether backfill is needed, current/last versions, and any active task.
   */
  async getBackfillSummary(workspaceId: string): Promise<BackfillSummary> {
    // Get current filter version from workspace
    const workspace = await this.workspacesService.get(workspaceId);
    const currentVersion = computeFilterVersion(
      workspace.settings.filters ?? [],
    );

    // Get all tasks for workspace, ordered by created_at DESC (use FINAL for ReplacingMergeTree)
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks FINAL
       WHERE workspace_id = {workspace_id:String}
       ORDER BY created_at DESC`,
      { workspace_id: workspaceId },
    );

    // Find active task (pending or running)
    const activeTaskRaw = tasks.find(
      (t) => t.status === 'pending' || t.status === 'running',
    );

    // Find last completed task
    const lastCompleted = tasks.find((t) => t.status === 'completed');

    // Compute last completed filter version
    let lastCompletedFilterVersion: string | null = null;
    if (lastCompleted) {
      const lastFilters: FilterDefinition[] = JSON.parse(
        lastCompleted.filters_snapshot || '[]',
      );
      lastCompletedFilterVersion = computeFilterVersion(lastFilters);
    }

    // Determine if backfill is needed
    const needsBackfill =
      !lastCompleted || lastCompletedFilterVersion !== currentVersion;

    return {
      needsBackfill,
      currentFilterVersion: currentVersion,
      lastCompletedFilterVersion,
      activeTask: activeTaskRaw ? this.toProgress(activeTaskRaw) : null,
    };
  }

  /**
   * Convert a BackfillTask to BackfillTaskProgress.
   */
  private toProgress(task: BackfillTask): BackfillTaskProgress {
    const sessionWeight = 0.7;
    const eventWeight = 0.3;

    const sessionProgress =
      task.total_sessions > 0
        ? task.processed_sessions / task.total_sessions
        : task.status === 'completed'
          ? 1
          : 0;

    const eventProgress =
      task.total_events > 0
        ? task.processed_events / task.total_events
        : task.status === 'completed'
          ? 1
          : 0;

    const progressPercent = Math.round(
      (sessionProgress * sessionWeight + eventProgress * eventWeight) * 100,
    );

    // Estimate remaining time based on sessions processed
    let estimatedRemainingSeconds: number | null = null;
    if (task.started_at && task.processed_sessions > 0) {
      const startedAt = new Date(task.started_at.replace(' ', 'T') + 'Z');
      const elapsedMs = Date.now() - startedAt.getTime();
      const elapsedSeconds = elapsedMs / 1000;
      const sessionsPerSecond = task.processed_sessions / elapsedSeconds;
      const remainingSessions = task.total_sessions - task.processed_sessions;
      estimatedRemainingSeconds = Math.round(
        remainingSessions / sessionsPerSecond,
      );
    }

    // Compute filter version from snapshot
    const filters: FilterDefinition[] = JSON.parse(
      task.filters_snapshot || '[]',
    );
    const filterVersion = computeFilterVersion(filters);

    return {
      id: task.id,
      status: task.status,
      progress_percent: progressPercent,
      sessions: {
        processed: task.processed_sessions,
        total: task.total_sessions,
      },
      events: {
        processed: task.processed_events,
        total: task.total_events,
      },
      current_chunk: task.current_date_chunk,
      started_at: task.started_at,
      completed_at: task.completed_at,
      error_message: task.error_message,
      estimated_remaining_seconds: estimatedRemainingSeconds,
      filter_version: filterVersion,
    };
  }
}
