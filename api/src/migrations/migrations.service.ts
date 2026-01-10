import { createClient, ClickHouseClient } from '@clickhouse/client';
import * as os from 'os';
import { APP_MAJOR_VERSION } from '../version';
import { MajorMigration } from './migration.interface';
import { MIGRATIONS } from './migrations.registry';

interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
}

/**
 * Standalone migration runner that runs before NestJS bootstrap.
 * Not a NestJS service - creates its own ClickHouse client.
 */
export class MigrationsRunner {
  private client: ClickHouseClient;
  private systemDb: string;
  private lockTimeout = 300; // 5 minutes in seconds

  constructor() {
    this.client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
    this.systemDb =
      process.env.CLICKHOUSE_SYSTEM_DATABASE || 'staminads_system';
  }

  /**
   * Run migration check and execute if needed.
   * @returns true if server should restart (migration was run)
   */
  async run(): Promise<boolean> {
    try {
      console.log('[Migrations] Starting migration check...');

      // Ensure system database and settings table exist
      await this.ensureSystemDatabase();

      // Try to acquire lock
      const lockAcquired = await this.acquireLock();
      if (!lockAcquired) {
        console.log(
          '[Migrations] Another instance is running migrations. Exiting to retry...',
        );
        return true; // Signal to exit and let container restart
      }

      try {
        // Get current DB version
        const dbVersion = await this.getDbVersion();
        console.log(
          `[Migrations] DB version: ${dbVersion ?? 'not set'}, Code version: ${APP_MAJOR_VERSION}`,
        );

        // Fresh install - set version and continue
        if (dbVersion === null) {
          console.log(
            `[Migrations] Fresh install detected. Setting version to ${APP_MAJOR_VERSION}`,
          );
          await this.setDbVersion(APP_MAJOR_VERSION);
          return false;
        }

        // Downgrade not supported
        if (dbVersion > APP_MAJOR_VERSION) {
          throw new Error(
            `Database version (${dbVersion}) is newer than code version (${APP_MAJOR_VERSION}). Downgrade not supported.`,
          );
        }

        // Already up to date
        if (dbVersion === APP_MAJOR_VERSION) {
          console.log('[Migrations] Database is up to date');
          return false;
        }

        // Need to migrate - find next migration
        const nextVersion = dbVersion + 1;
        const migration = this.getMigration(nextVersion);
        if (!migration) {
          throw new Error(
            `Migration for version ${nextVersion} not found. Cannot upgrade from ${dbVersion} to ${APP_MAJOR_VERSION}.`,
          );
        }

        // Run the migration
        console.log(
          `[Migrations] Running migration to version ${nextVersion}...`,
        );
        await this.executeMigration(migration);

        // Update version
        await this.setDbVersion(nextVersion);
        console.log(
          `[Migrations] Migration to version ${nextVersion} completed`,
        );

        return true; // Signal to restart
      } finally {
        await this.releaseLock();
        console.log('[Migrations] Released migration lock');
      }
    } finally {
      await this.client.close();
    }
  }

  private async ensureSystemDatabase(): Promise<void> {
    // Create system database if not exists
    await this.client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${this.systemDb}`,
    });

    // Create system_settings table if not exists
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${this.systemDb}.system_settings (
          key String,
          value String,
          updated_at DateTime64(3) DEFAULT now64(3)
        ) ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY (key)
      `,
    });
  }

  private async acquireLock(): Promise<boolean> {
    const lockId = `${os.hostname()}-${process.pid}`;

    // Check if lock exists and is not expired
    const result = await this.client.query({
      query: `
        SELECT value, updated_at
        FROM ${this.systemDb}.system_settings FINAL
        WHERE key = 'migration_lock'
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json<SettingsRow>();

    if (rows.length > 0) {
      // Parse as UTC (ClickHouse returns UTC without 'Z' suffix)
      const lockTime = new Date(
        rows[0].updated_at.replace(' ', 'T') + 'Z',
      ).getTime();
      const lockAge = (Date.now() - lockTime) / 1000;

      if (lockAge < this.lockTimeout) {
        console.log(
          `[Migrations] Lock held by ${rows[0].value} (${Math.round(lockAge)}s old)`,
        );
        return false; // Lock held by another instance
      }
      console.log('[Migrations] Found expired lock, taking over...');
    }

    // Acquire lock
    await this.client.insert({
      table: `${this.systemDb}.system_settings`,
      values: [
        {
          key: 'migration_lock',
          value: lockId,
          updated_at: new Date().toISOString().replace('T', ' ').slice(0, 23),
        },
      ],
      format: 'JSONEachRow',
    });

    console.log('[Migrations] Acquired migration lock');
    return true;
  }

  private async releaseLock(): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE ${this.systemDb}.system_settings DELETE WHERE key = 'migration_lock'`,
    });
  }

  private async getDbVersion(): Promise<number | null> {
    const result = await this.client.query({
      query: `
        SELECT value
        FROM ${this.systemDb}.system_settings FINAL
        WHERE key = 'db_major_version'
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ value: string }>();

    if (rows.length === 0) {
      return null;
    }

    return parseInt(rows[0].value, 10);
  }

  private async setDbVersion(version: number): Promise<void> {
    await this.client.insert({
      table: `${this.systemDb}.system_settings`,
      values: [
        {
          key: 'db_major_version',
          value: String(version),
          updated_at: new Date().toISOString().replace('T', ' ').slice(0, 23),
        },
      ],
      format: 'JSONEachRow',
    });
  }

  private getMigration(version: number): MajorMigration | undefined {
    return MIGRATIONS.find((m) => m.majorVersion === version);
  }

  private async executeMigration(migration: MajorMigration): Promise<void> {
    // Run system migration
    if (migration.hasSystemMigration()) {
      console.log('[Migrations] Running system migration...');
      await migration.migrateSystem(this.client, this.systemDb);
      console.log('[Migrations] System migration completed');
    }

    // Run workspace migrations
    if (migration.hasWorkspaceMigration()) {
      const workspaces = await this.getWorkspaces();
      console.log(
        `[Migrations] Running workspace migrations for ${workspaces.length} workspaces...`,
      );

      for (let i = 0; i < workspaces.length; i++) {
        const workspaceId = workspaces[i];
        const workspaceDb = this.getWorkspaceDatabaseName(workspaceId);
        console.log(
          `[Migrations] Migrating workspace ${i + 1}/${workspaces.length}: ${workspaceId}`,
        );

        // Abort on first failure
        await migration.migrateWorkspace(this.client, workspaceDb);
      }
      console.log('[Migrations] Workspace migrations completed');
    }
  }

  private async getWorkspaces(): Promise<string[]> {
    const result = await this.client.query({
      query: `SELECT DISTINCT id FROM ${this.systemDb}.workspaces`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<WorkspaceRow>();
    return rows.map((r) => r.id);
  }

  private getWorkspaceDatabaseName(workspaceId: string): string {
    const sanitized = workspaceId.replace(/[^a-zA-Z0-9_]/g, '_');
    return `staminads_ws_${sanitized}`;
  }
}
