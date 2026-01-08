import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from '../migration.interface';
import { WORKSPACE_SCHEMAS } from '../../database/schemas';

/**
 * V3 Migration: Full Page Analytics
 *
 * Changes:
 * - events: Added page_duration column
 * - sessions: Added pageview_count and median_page_duration columns
 * - sessions_mv: Updated with new aggregations (uses medianIf for robustness)
 * - pages: New table for per-page analytics
 * - pages_mv: New materialized view for pages
 *
 * Since this is a dev environment, we DROP and recreate workspace tables.
 */
export class V3Migration implements MajorMigration {
  majorVersion = 3;

  hasSystemMigration(): boolean {
    return false; // No system table changes
  }

  hasWorkspaceMigration(): boolean {
    return true; // Need to recreate workspace tables
  }

  async migrateSystem(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    client: ClickHouseClient,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    systemDb: string,
  ): Promise<void> {
    // No system changes for v3
  }

  async migrateWorkspace(
    client: ClickHouseClient,
    workspaceDb: string,
  ): Promise<void> {
    // Drop MVs first (they depend on tables)
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.sessions_mv`,
    });
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.pages_mv`,
    });

    // Drop tables
    await client.command({
      query: `DROP TABLE IF EXISTS ${workspaceDb}.pages`,
    });
    await client.command({
      query: `DROP TABLE IF EXISTS ${workspaceDb}.sessions`,
    });
    await client.command({
      query: `DROP TABLE IF EXISTS ${workspaceDb}.events`,
    });

    // Recreate tables with new schema
    await client.command({
      query: WORKSPACE_SCHEMAS.events.replace(/{database}/g, workspaceDb),
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.sessions.replace(/{database}/g, workspaceDb),
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.sessions_mv.replace(/{database}/g, workspaceDb),
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.pages.replace(/{database}/g, workspaceDb),
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.pages_mv.replace(/{database}/g, workspaceDb),
    });

    console.log(`[V3Migration] Recreated workspace tables for ${workspaceDb}`);
  }
}
