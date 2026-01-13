import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from './migration.interface';

/**
 * V5 Subscriptions Migration
 *
 * Creates the report_subscriptions table for email report subscriptions.
 * This table stores user subscription preferences for scheduled analytics reports.
 */
export const V5SubscriptionsMigration: MajorMigration = {
  majorVersion: 5,

  hasSystemMigration(): boolean {
    return true;
  },

  hasWorkspaceMigration(): boolean {
    return false;
  },

  async migrateSystem(
    client: ClickHouseClient,
    systemDb: string,
  ): Promise<void> {
    console.log('[V5 Migration] Creating report_subscriptions table...');

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${systemDb}.report_subscriptions (
          id String,
          user_id String,
          workspace_id String,
          name String,
          frequency Enum8('daily' = 1, 'weekly' = 2, 'monthly' = 3),
          day_of_week Nullable(UInt8),
          day_of_month Nullable(UInt8),
          hour UInt8 DEFAULT 8,
          timezone String DEFAULT 'UTC',
          metrics Array(String),
          dimensions Array(String),
          filters String DEFAULT '[]',
          \`limit\` UInt8 DEFAULT 10,
          status Enum8('active' = 1, 'paused' = 2, 'disabled' = 3) DEFAULT 'active',
          last_sent_at Nullable(DateTime64(3)),
          last_send_status Enum8('pending' = 0, 'success' = 1, 'failed' = 2) DEFAULT 'pending',
          last_error String DEFAULT '',
          next_send_at Nullable(DateTime64(3)),
          consecutive_failures UInt8 DEFAULT 0,
          created_at DateTime64(3) DEFAULT now64(3),
          updated_at DateTime64(3) DEFAULT now64(3)
        ) ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY (user_id, workspace_id, id)
      `,
    });

    console.log('[V5 Migration] report_subscriptions table created');
  },

  async migrateWorkspace(): Promise<void> {
    // No workspace-level changes
  },
};
