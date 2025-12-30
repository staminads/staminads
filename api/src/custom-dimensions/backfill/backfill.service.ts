import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClickHouseService } from '../../database/clickhouse.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { StartBackfillDto } from './dto/start-backfill.dto';
import { BackfillTask, BackfillTaskProgress } from './backfill-task.entity';

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class BackfillService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  /**
   * Start a new backfill task for a workspace.
   * Returns immediately with a task_id for polling.
   */
  async startBackfill(dto: StartBackfillDto): Promise<{ task_id: string }> {
    // Validate workspace exists
    const workspace = await this.workspacesService.get(dto.workspace_id);

    // Check for running tasks in system database
    const runningTasks = await this.clickhouse.querySystem<{ id: string }>(
      `SELECT id FROM backfill_tasks
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

    // Create task
    const taskId = randomUUID();
    const now = toClickHouseDateTime();

    const task = {
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
      started_at: null,
      completed_at: null,
      error_message: null,
      retry_count: 0,
      dimensions_snapshot: JSON.stringify(workspace.custom_dimensions ?? []),
    };

    await this.clickhouse.insertSystem('backfill_tasks', [task]);

    // TODO: Spawn processor asynchronously
    // For now, just return the task_id
    // The processor will be implemented separately

    return { task_id: taskId };
  }

  /**
   * Get the status and progress of a backfill task.
   */
  async getTaskStatus(taskId: string): Promise<BackfillTaskProgress> {
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks WHERE id = {id:String}`,
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
  async cancelTask(taskId: string): Promise<{ success: boolean }> {
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks WHERE id = {id:String}`,
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

    await this.clickhouse.commandSystem(
      `ALTER TABLE backfill_tasks UPDATE status = 'cancelled', completed_at = now64(3) WHERE id = '${taskId}'`,
    );

    return { success: true };
  }

  /**
   * List all backfill tasks for a workspace.
   */
  async listTasks(workspaceId: string): Promise<BackfillTaskProgress[]> {
    const tasks = await this.clickhouse.querySystem<BackfillTask>(
      `SELECT * FROM backfill_tasks
       WHERE workspace_id = {workspace_id:String}
       ORDER BY created_at DESC`,
      { workspace_id: workspaceId },
    );

    return tasks.map((task) => this.toProgress(task));
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
      estimatedRemainingSeconds = Math.round(remainingSessions / sessionsPerSecond);
    }

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
    };
  }
}
