import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from '../migration.interface';
import { WORKSPACE_SCHEMAS } from '../../database/schemas';

/**
 * V3 Migration: Full Page Analytics (Non-Destructive)
 *
 * Changes:
 * - events: Added page_duration and previous_path columns
 * - sessions: Added pageview_count and median_page_duration columns
 * - sessions_mv: Updated with new aggregations (uses medianIf for robustness)
 * - pages: New table for per-page analytics
 * - pages_mv: New materialized view for pages
 *
 * This migration preserves existing data:
 * - Uses ALTER TABLE ADD COLUMN for new columns (existing rows get defaults)
 * - Only drops/recreates MVs (target tables keep their data)
 * - New MV logic only applies to new inserts
 */
export class V3Migration implements MajorMigration {
  majorVersion = 3;

  hasSystemMigration(): boolean {
    return false;
  }

  hasWorkspaceMigration(): boolean {
    return true;
  }

  async migrateSystem(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _client: ClickHouseClient,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _systemDb: string,
  ): Promise<void> {
    // No system changes for v3
  }

  async migrateWorkspace(
    client: ClickHouseClient,
    workspaceDb: string,
  ): Promise<void> {
    // Step 1: Add new columns to events table (preserves existing data)
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS page_duration UInt32 DEFAULT 0`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS previous_path String DEFAULT ''`,
    });

    // Step 2: Add new columns to sessions table (preserves existing data)
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.sessions
              ADD COLUMN IF NOT EXISTS pageview_count UInt16 DEFAULT 1`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.sessions
              ADD COLUMN IF NOT EXISTS median_page_duration UInt32 DEFAULT 0`,
    });

    // Step 3: Drop and recreate sessions_mv with new logic
    // (sessions table keeps its data, new logic applies to new inserts only)
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.sessions_mv`,
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.sessions_mv.replace(/{database}/g, workspaceDb),
    });

    // Step 4: Create pages table if not exists (new table for v3)
    await client.command({
      query: WORKSPACE_SCHEMAS.pages.replace(/{database}/g, workspaceDb),
    });

    // Step 5: Drop and recreate pages_mv with correct logic
    // (handles both fresh installs and updates to fix entered_at calculation)
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.pages_mv`,
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.pages_mv.replace(/{database}/g, workspaceDb),
    });

    console.log(
      `[V3Migration] Non-destructive migration complete for ${workspaceDb}`,
    );
  }
}
