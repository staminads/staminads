import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { generateEvents } from './fixtures/generators';
import { TrackingEvent } from '../events/entities/event.entity';
import { randomUUID } from 'crypto';

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

    // Delete existing demo workspace if it exists
    await this.deleteExistingDemo();

    // Create new workspace
    const workspaceId = `demo-apple-${randomUUID().slice(0, 8)}`;
    const workspace = await this.createWorkspace(workspaceId);

    this.logger.log(`Created workspace: ${workspaceId}`);

    // Generate events (not sessions - MV will create sessions)
    const endDate = new Date();
    const events = generateEvents({
      workspaceId,
      sessionCount: SESSION_COUNT,
      endDate,
      daysRange: DAYS_RANGE,
    });

    this.logger.log(`Generated ${events.length} events for ${SESSION_COUNT} sessions`);

    // Insert events in batches
    await this.insertEventsBatched(events);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    this.logger.log(`Demo generation completed in ${duration}s`);

    // Calculate date range
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - DAYS_RANGE);

    return {
      workspace_id: workspaceId,
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
        message: 'Demo workspace, events, and sessions deleted',
      };
    }

    return {
      success: true,
      message: 'No demo workspace found',
    };
  }

  private async deleteExistingDemo(): Promise<boolean> {
    // Find existing demo workspace
    const workspaces = await this.clickhouse.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE name = {name:String} LIMIT 1`,
      { name: DEMO_WORKSPACE_NAME },
    );

    if (workspaces.length === 0) {
      return false;
    }

    const workspaceId = workspaces[0].id;

    // Delete events for this workspace
    await this.clickhouse.command(
      `ALTER TABLE events DELETE WHERE workspace_id = '${workspaceId}'`,
    );

    // Delete sessions for this workspace (populated by MV)
    await this.clickhouse.command(
      `ALTER TABLE sessions DELETE WHERE workspace_id = '${workspaceId}'`,
    );

    // Delete workspace
    await this.clickhouse.command(
      `ALTER TABLE workspaces DELETE WHERE id = '${workspaceId}'`,
    );

    this.logger.log(`Deleted existing demo workspace: ${workspaceId}`);

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
      created_at: now,
      updated_at: now,
    };

    await this.clickhouse.insert('workspaces', [workspace]);

    return workspace;
  }

  private async insertEventsBatched(events: TrackingEvent[]): Promise<void> {
    const totalBatches = Math.ceil(events.length / BATCH_SIZE);

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

      await this.clickhouse.insert('events', batch);

      this.logger.log(`Inserted batch ${batchNumber}/${totalBatches} (${batch.length} events)`);
    }
  }
}
