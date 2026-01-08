import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from '../migration.interface';
import { WORKSPACE_SCHEMAS } from '../../database/schemas';

/**
 * V3 Migration: Full Page Analytics + Session Payload Support (Non-Destructive)
 *
 * Changes:
 * - events: Added page_duration, previous_path columns (page analytics)
 * - events: Added page_number, _version, goal_name, goal_value, dedup_token (session payload)
 * - sessions: Added pageview_count, median_page_duration (page analytics)
 * - sessions: Added goal_count, goal_value (goal tracking)
 * - sessions_mv: Updated with page analytics and goal aggregations
 * - pages: New table for per-page analytics (page_number widened to UInt16)
 * - pages_mv: New materialized view using page_number from events
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

    // Step 2b: Session payload columns for events table
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS page_number UInt16 DEFAULT 0`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS _version UInt64 DEFAULT 0`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS goal_name String DEFAULT ''`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS goal_value Float32 DEFAULT 0`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events
              ADD COLUMN IF NOT EXISTS dedup_token String DEFAULT ''`,
    });

    // Step 2c: Goal tracking columns for sessions table
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.sessions
              ADD COLUMN IF NOT EXISTS goal_count UInt16 DEFAULT 0`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.sessions
              ADD COLUMN IF NOT EXISTS goal_value Float32 DEFAULT 0`,
    });

    // Step 3: Drop and recreate sessions_mv with new logic
    // (sessions table keeps its data, new logic applies to new inserts only)
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.sessions_mv`,
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.sessions_mv.replace(/{database}/g, workspaceDb),
    });

    // === Phase 4: Pages table changes ===
    // Since we're changing ENGINE (MergeTree -> ReplacingMergeTree) and ORDER BY,
    // we need to recreate the table. Strategy: create new, copy data, swap, drop old.

    // Step 4a: Drop pages_mv first (depends on pages table)
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.pages_mv`,
    });

    // Step 4b: Check if pages table exists and needs recreation
    const pagesTableResult = await client.query({
      query: `
        SELECT engine
        FROM system.tables
        WHERE database = '${workspaceDb}' AND name = 'pages'
      `,
    });
    const pagesTableData = await pagesTableResult.json<{ engine: string }>();
    const pagesTableExists = pagesTableData.data.length > 0;
    const pagesNeedsRecreation =
      pagesTableExists &&
      pagesTableData.data[0].engine !== 'ReplacingMergeTree';

    if (pagesNeedsRecreation) {
      // Step 4c: Check if pages_new already exists (idempotency)
      const pagesNewResult = await client.query({
        query: `
          SELECT count() as cnt
          FROM system.tables
          WHERE database = '${workspaceDb}' AND name = 'pages_new'
        `,
      });
      const pagesNewData = await pagesNewResult.json<{ cnt: string }>();

      if (Number(pagesNewData.data[0].cnt) === 0) {
        // Step 4d: Create new pages table with correct schema
        await client.command({
          query: WORKSPACE_SCHEMAS.pages
            .replace(/{database}\.pages/g, `${workspaceDb}.pages_new`)
            .replace(/{database}/g, workspaceDb),
        });

        // Step 4e: Copy existing data with generated page_id
        await client.command({
          query: `
            INSERT INTO ${workspaceDb}.pages_new
            SELECT
              id,
              concat(session_id, '_', toString(page_number)) as page_id,
              session_id,
              workspace_id,
              path,
              full_url,
              entered_at,
              exited_at,
              duration,
              max_scroll,
              page_number,
              is_landing,
              is_exit,
              entry_type,
              received_at,
              0 as _version
            FROM ${workspaceDb}.pages
          `,
        });
      }

      // Step 4f: Swap tables
      const pagesNewExistsForSwap = await client.query({
        query: `
          SELECT count() as cnt
          FROM system.tables
          WHERE database = '${workspaceDb}' AND name = 'pages_new'
        `,
      });
      const swapData = await pagesNewExistsForSwap.json<{ cnt: string }>();

      if (Number(swapData.data[0].cnt) > 0) {
        await client.command({
          query: `DROP TABLE IF EXISTS ${workspaceDb}.pages`,
        });
        await client.command({
          query: `RENAME TABLE ${workspaceDb}.pages_new TO ${workspaceDb}.pages`,
        });
      }
    } else if (!pagesTableExists) {
      // Step 4g: Fresh install - create pages table directly
      await client.command({
        query: WORKSPACE_SCHEMAS.pages.replace(/{database}/g, workspaceDb),
      });
    }
    // If pagesTableExists && !pagesNeedsRecreation, table already has correct engine

    // Step 4h: Ensure page_id and _version columns exist (for tables that were already ReplacingMergeTree)
    if (pagesTableExists && !pagesNeedsRecreation) {
      await client.command({
        query: `ALTER TABLE ${workspaceDb}.pages
                ADD COLUMN IF NOT EXISTS page_id String DEFAULT ''`,
      });
      await client.command({
        query: `ALTER TABLE ${workspaceDb}.pages
                ADD COLUMN IF NOT EXISTS _version UInt64 DEFAULT 0`,
      });
    }

    // Step 5: Recreate pages_mv with V3 logic
    await client.command({
      query: WORKSPACE_SCHEMAS.pages_mv.replace(/{database}/g, workspaceDb),
    });

    console.log(
      `[V3Migration] Non-destructive migration complete for ${workspaceDb}`,
    );
  }
}
