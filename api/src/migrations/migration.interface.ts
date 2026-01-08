import { ClickHouseClient } from '@clickhouse/client';

/**
 * Interface for major version migrations.
 * Each migration handles upgrading from majorVersion-1 to majorVersion.
 */
export interface MajorMigration {
  /** The major version this migration upgrades TO */
  majorVersion: number;

  /** Whether this migration has system-level changes */
  hasSystemMigration(): boolean;

  /** Whether this migration has workspace-level changes */
  hasWorkspaceMigration(): boolean;

  /**
   * Run system-level migration (tables in system database).
   * Called once if hasSystemMigration() returns true.
   */
  migrateSystem(client: ClickHouseClient, systemDb: string): Promise<void>;

  /**
   * Run workspace-level migration.
   * Called for each workspace if hasWorkspaceMigration() returns true.
   * @param workspaceDb - The workspace database name (e.g., staminads_ws_abc123)
   */
  migrateWorkspace(
    client: ClickHouseClient,
    workspaceDb: string,
  ): Promise<void>;
}
