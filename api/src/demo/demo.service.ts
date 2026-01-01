import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { generateEvents, getCachedFilters, clearFilterCache } from './fixtures/generators';
import { TrackingEvent } from '../events/entities/event.entity';
import { DEMO_CUSTOM_DIMENSION_LABELS } from './fixtures/demo-filters';

const DEMO_WORKSPACE_ID = 'demo-apple';
const DEMO_WORKSPACE_NAME = 'Apple Demo';
const DEMO_WEBSITE = 'https://www.apple.com';
const SESSION_COUNT = 10000;
const DAYS_RANGE = 90;
const BATCH_SIZE = 1000;

interface Workspace {
  id: string;
  name: string;
  website: string;
  timezone: string;
  currency: string;
  logo_url: string | null;
  timescore_reference: number;
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

    // Generate events (not sessions - MV will create sessions)
    const endDate = new Date();
    const events = generateEvents({
      workspaceId: DEMO_WORKSPACE_ID,
      sessionCount: SESSION_COUNT,
      endDate,
      daysRange: DAYS_RANGE,
    });

    this.logger.log(`Generated ${events.length} events for ${SESSION_COUNT} sessions`);

    // Insert events in batches
    await this.insertEventsBatched(DEMO_WORKSPACE_ID, events);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    this.logger.log(`Demo generation completed in ${duration}s`);

    // Calculate date range
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - DAYS_RANGE);

    return {
      workspace_id: DEMO_WORKSPACE_ID,
      workspace_name: DEMO_WORKSPACE_NAME,
      events_count: events.length,
      sessions_count: SESSION_COUNT,
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
      timescore_reference: 60,
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
    const totalBatches = Math.ceil(events.length / BATCH_SIZE);

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

      // Insert to workspace database
      await this.clickhouse.insertWorkspace(workspaceId, 'events', batch);

      this.logger.log(`Inserted batch ${batchNumber}/${totalBatches} (${batch.length} events)`);
    }
  }
}
