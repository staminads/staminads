import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClickHouseService } from '../database/clickhouse.service';
import { generateEventsByDay, getCachedFilters, clearFilterCache } from './fixtures/generators';
import { TrackingEvent } from '../events/entities/event.entity';
import { DEMO_CUSTOM_DIMENSION_LABELS } from './fixtures/demo-filters';
import { BackfillTask } from '../filters/backfill/backfill-task.entity';

const DEMO_WORKSPACE_ID = 'demo-apple';
const DEMO_WORKSPACE_NAME = 'Apple Demo';
const DEMO_WEBSITE = 'https://www.apple.com';
const SESSION_COUNT = 200_000;
const DAYS_RANGE = 90;
const BATCH_SIZE = 10_000;

interface Workspace {
  id: string;
  name: string;
  website: string;
  timezone: string;
  currency: string;
  logo_url: string | null;
  timescore_reference: number;
  bounce_threshold: number;
  status: string;
  custom_dimensions: string;
  filters: string;
  created_at: string;
  updated_at: string;
}

function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(private readonly clickhouse: ClickHouseService) {}

  async generate() {
    const startTime = Date.now();

    // Clear filter cache to ensure fresh filter IDs for this generation
    clearFilterCache();

    // Delete existing demo workspace if it exists
    await this.deleteExistingDemo();

    // Create new workspace with fixed ID
    const workspace = await this.createWorkspace(DEMO_WORKSPACE_ID);

    this.logger.log(`Created workspace: ${DEMO_WORKSPACE_ID}`);
    this.logger.log(`Generating ${SESSION_COUNT.toLocaleString()} sessions over ${DAYS_RANGE} days...`);

    // Generate and insert events day-by-day using streaming generator
    const endDate = new Date();
    const generator = generateEventsByDay({
      workspaceId: DEMO_WORKSPACE_ID,
      sessionCount: SESSION_COUNT,
      endDate,
      daysRange: DAYS_RANGE,
    });

    let totalEvents = 0;
    let totalSessions = 0;
    let dayCount = 0;

    for (const dayBatch of generator) {
      dayCount++;
      totalSessions += dayBatch.sessionCount;

      // Insert this day's events in sub-batches
      await this.insertEventsBatched(DEMO_WORKSPACE_ID, dayBatch.events);
      totalEvents += dayBatch.events.length;

      // Log progress every 10 days
      if (dayCount % 10 === 0 || dayCount === DAYS_RANGE) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(totalSessions / parseFloat(elapsed));
        this.logger.log(
          `Day ${dayCount}/${DAYS_RANGE}: ${totalSessions.toLocaleString()} sessions, ` +
          `${totalEvents.toLocaleString()} events (${rate} sessions/s)`,
        );
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    this.logger.log(`Demo generation completed in ${duration}s`);

    // Create a completed backfill task to mark filters as synced
    await this.createCompletedBackfillTask(DEMO_WORKSPACE_ID, totalSessions, totalEvents);

    // Calculate date range
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - DAYS_RANGE);

    return {
      workspace_id: DEMO_WORKSPACE_ID,
      workspace_name: DEMO_WORKSPACE_NAME,
      events_count: totalEvents,
      sessions_count: totalSessions,
      date_range: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      },
      generation_time_seconds: parseFloat(duration),
    };
  }

  async delete() {
    const deleted = await this.deleteExistingDemo();

    if (deleted) {
      return {
        success: true,
        message: 'Demo workspace and database deleted',
      };
    }

    return {
      success: true,
      message: 'No demo workspace found',
    };
  }

  private async deleteExistingDemo(): Promise<boolean> {
    // Check if demo workspace exists in system database
    const workspaces = await this.clickhouse.querySystem<{ id: string }>(
      `SELECT id FROM workspaces WHERE id = {id:String} LIMIT 1`,
      { id: DEMO_WORKSPACE_ID },
    );

    if (workspaces.length === 0) {
      return false;
    }

    // Drop workspace database (cascades to all tables - events, sessions, etc.)
    await this.clickhouse.dropWorkspaceDatabase(DEMO_WORKSPACE_ID);

    // Delete workspace row from system database
    await this.clickhouse.commandSystem(
      `ALTER TABLE workspaces DELETE WHERE id = '${DEMO_WORKSPACE_ID}'`,
    );

    // Delete backfill tasks for this workspace from system database
    await this.clickhouse.commandSystem(
      `ALTER TABLE backfill_tasks DELETE WHERE workspace_id = '${DEMO_WORKSPACE_ID}'`,
    );

    this.logger.log(`Deleted existing demo workspace: ${DEMO_WORKSPACE_ID}`);

    return true;
  }

  private async createWorkspace(workspaceId: string): Promise<Workspace> {
    const now = toClickHouseDateTime();

    const workspace: Workspace = {
      id: workspaceId,
      name: DEMO_WORKSPACE_NAME,
      website: DEMO_WEBSITE,
      timezone: 'America/New_York',
      currency: 'USD',
      logo_url: 'https://www.apple.com/ac/structured-data/images/knowledge_graph_logo.png',
      timescore_reference: 180, // 3 minutes
      bounce_threshold: 10,
      status: 'active',
      custom_dimensions: JSON.stringify(DEMO_CUSTOM_DIMENSION_LABELS),
      filters: JSON.stringify(getCachedFilters().filters),
      created_at: now,
      updated_at: now,
    };

    // Create workspace database first
    await this.clickhouse.createWorkspaceDatabase(workspaceId);

    // Insert workspace row into system database
    await this.clickhouse.insertSystem('workspaces', [workspace]);

    return workspace;
  }

  private async insertEventsBatched(
    workspaceId: string,
    events: TrackingEvent[],
  ): Promise<void> {
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);

      // Insert to workspace database
      await this.clickhouse.insertWorkspace(workspaceId, 'events', batch);
    }
  }

  /**
   * Create a synthetic completed backfill task to mark filters as synced.
   * Since demo data is generated with filters already applied, we create
   * a completed task record to prevent "Filters out of sync" warning.
   */
  private async createCompletedBackfillTask(
    workspaceId: string,
    sessionsCount: number,
    eventsCount: number,
  ): Promise<void> {
    const { filters } = getCachedFilters();
    const now = toClickHouseDateTime();

    const task: BackfillTask = {
      id: randomUUID(),
      workspace_id: workspaceId,
      status: 'completed',
      lookback_days: DAYS_RANGE,
      chunk_size_days: 1,
      batch_size: BATCH_SIZE,
      total_sessions: sessionsCount,
      processed_sessions: sessionsCount,
      total_events: eventsCount,
      processed_events: eventsCount,
      current_date_chunk: null,
      created_at: now,
      updated_at: now,
      started_at: now,
      completed_at: now,
      error_message: null,
      retry_count: 0,
      filters_snapshot: JSON.stringify(filters),
    };

    await this.clickhouse.insertSystem('backfill_tasks', [task]);
    this.logger.log('Created completed backfill task for demo workspace');
  }
}
