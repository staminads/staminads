import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from './migration.interface';

/**
 * V4 Reset Migration
 *
 * This migration drops ALL databases (system and workspace).
 * V4 introduces a new SDK payload format and events table schema.
 * There is NO backward compatibility - all data will be lost.
 *
 * WARNING: This is a destructive migration that cannot be undone.
 */
export const V4ResetMigration: MajorMigration = {
  majorVersion: 4,

  hasSystemMigration(): boolean {
    return true;
  },

  hasWorkspaceMigration(): boolean {
    return true;
  },

  async migrateSystem(
    client: ClickHouseClient,
    systemDb: string,
  ): Promise<void> {
    console.log('[V4 Migration] Dropping system database tables...');

    // Get all tables in the system database
    const result = await client.query({
      query: `SELECT name FROM system.tables WHERE database = '${systemDb}'`,
      format: 'JSONEachRow',
    });
    const tables = await result.json<{ name: string }>();

    // Drop each table (except system_settings which is needed for migrations)
    for (const { name } of tables) {
      if (name === 'system_settings') {
        // Clear all data except migration lock
        await client.command({
          query: `ALTER TABLE ${systemDb}.system_settings DELETE WHERE key != 'migration_lock'`,
        });
        console.log(`[V4 Migration] Cleared ${systemDb}.system_settings`);
      } else {
        await client.command({
          query: `DROP TABLE IF EXISTS ${systemDb}.${name}`,
        });
        console.log(`[V4 Migration] Dropped ${systemDb}.${name}`);
      }
    }

    console.log('[V4 Migration] System database reset complete');
  },

  async migrateWorkspace(
    client: ClickHouseClient,
    workspaceDb: string,
  ): Promise<void> {
    console.log(`[V4 Migration] Dropping workspace database: ${workspaceDb}`);

    await client.command({
      query: `DROP DATABASE IF EXISTS ${workspaceDb}`,
    });

    console.log(`[V4 Migration] Dropped ${workspaceDb}`);
  },
};
