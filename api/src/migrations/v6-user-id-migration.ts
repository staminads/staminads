import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from './migration.interface';

/**
 * V6 User ID Migration
 *
 * Adds user_id column to workspace tables (events, sessions, pages, goals)
 * to support tracking authenticated user identity across sessions.
 *
 * This enables:
 * - Setting user ID from the SDK via setUserId()
 * - Exporting user events via export.userEvents endpoint
 * - Filtering analytics by user_id dimension
 */
export const V6UserIdMigration: MajorMigration = {
  majorVersion: 6,

  hasSystemMigration(): boolean {
    return false;
  },

  hasWorkspaceMigration(): boolean {
    return true;
  },

  async migrateSystem(): Promise<void> {
    // No system-level changes
  },

  async migrateWorkspace(
    client: ClickHouseClient,
    workspaceDb: string,
  ): Promise<void> {
    console.log(`[V6 Migration] Adding user_id column to ${workspaceDb}...`);

    // Add user_id column to events table
    console.log(`[V6 Migration] Adding user_id to events table...`);
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events ADD COLUMN IF NOT EXISTS user_id Nullable(String)`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.events ADD INDEX IF NOT EXISTS idx_user_id user_id TYPE bloom_filter GRANULARITY 1`,
    });

    // Add user_id column to sessions table
    console.log(`[V6 Migration] Adding user_id to sessions table...`);
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.sessions ADD COLUMN IF NOT EXISTS user_id Nullable(String)`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.sessions ADD INDEX IF NOT EXISTS idx_user_id user_id TYPE bloom_filter GRANULARITY 1`,
    });

    // Add user_id column to pages table
    console.log(`[V6 Migration] Adding user_id to pages table...`);
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.pages ADD COLUMN IF NOT EXISTS user_id Nullable(String)`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.pages ADD INDEX IF NOT EXISTS idx_user_id user_id TYPE bloom_filter GRANULARITY 1`,
    });

    // Add user_id column to goals table
    console.log(`[V6 Migration] Adding user_id to goals table...`);
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.goals ADD COLUMN IF NOT EXISTS user_id Nullable(String)`,
    });
    await client.command({
      query: `ALTER TABLE ${workspaceDb}.goals ADD INDEX IF NOT EXISTS idx_user_id user_id TYPE bloom_filter GRANULARITY 1`,
    });

    // Recreate materialized views to include user_id column
    // MVs don't automatically pick up new columns - they need to be recreated
    console.log(`[V6 Migration] Recreating materialized views...`);

    // Recreate sessions_mv
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.sessions_mv`,
    });
    await client.command({
      query: `
        CREATE MATERIALIZED VIEW ${workspaceDb}.sessions_mv
        TO ${workspaceDb}.sessions AS
        SELECT
          e.session_id as id,
          e.workspace_id,
          any(e.created_at) as created_at,
          max(e.updated_at) as updated_at,
          max(e.duration) as duration,
          countIf(e.name = 'screen_view') as pageview_count,
          toUInt32(if(isNaN(medianIf(e.page_duration, e.page_duration > 0)), 0, round(medianIf(e.page_duration, e.page_duration > 0)))) as median_page_duration,
          any(toYear(e.created_at)) as year,
          any(toMonth(e.created_at)) as month,
          any(toDayOfMonth(e.created_at)) as day,
          any(toDayOfWeek(e.created_at)) as day_of_week,
          any(toWeek(e.created_at)) as week_number,
          any(toHour(e.created_at)) as hour,
          any(toDayOfWeek(e.created_at) IN (6, 7)) as is_weekend,
          any(e.referrer) as referrer,
          any(e.referrer_domain) as referrer_domain,
          any(e.referrer_path) as referrer_path,
          any(e.is_direct) as is_direct,
          any(e.landing_page) as landing_page,
          any(e.landing_domain) as landing_domain,
          any(e.landing_path) as landing_path,
          argMax(e.path, e.updated_at) as exit_path,
          any(e.utm_source) as utm_source,
          any(e.utm_medium) as utm_medium,
          any(e.utm_campaign) as utm_campaign,
          any(e.utm_term) as utm_term,
          any(e.utm_content) as utm_content,
          any(e.utm_id) as utm_id,
          any(e.utm_id_from) as utm_id_from,
          any(e.channel) as channel,
          any(e.channel_group) as channel_group,
          any(e.stm_1) as stm_1,
          any(e.stm_2) as stm_2,
          any(e.stm_3) as stm_3,
          any(e.stm_4) as stm_4,
          any(e.stm_5) as stm_5,
          any(e.stm_6) as stm_6,
          any(e.stm_7) as stm_7,
          any(e.stm_8) as stm_8,
          any(e.stm_9) as stm_9,
          any(e.stm_10) as stm_10,
          any(e.screen_width) as screen_width,
          any(e.screen_height) as screen_height,
          any(e.viewport_width) as viewport_width,
          any(e.viewport_height) as viewport_height,
          any(e.user_agent) as user_agent,
          any(e.language) as language,
          any(e.timezone) as timezone,
          any(e.country) as country,
          any(e.region) as region,
          any(e.city) as city,
          any(e.latitude) as latitude,
          any(e.longitude) as longitude,
          any(e.browser) as browser,
          any(e.browser_type) as browser_type,
          any(e.os) as os,
          any(e.device) as device,
          any(e.connection_type) as connection_type,
          max(e.max_scroll) as max_scroll,
          countIf(e.name = 'goal') as goal_count,
          sumIf(e.goal_value, e.name = 'goal') as goal_value,
          any(e.sdk_version) as sdk_version,
          any(e.user_id) as user_id
        FROM ${workspaceDb}.events e
        GROUP BY e.session_id, e.workspace_id
      `,
    });

    // Recreate pages_mv
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.pages_mv`,
    });
    await client.command({
      query: `
        CREATE MATERIALIZED VIEW ${workspaceDb}.pages_mv
        TO ${workspaceDb}.pages AS
        SELECT
          generateUUIDv4() as id,
          concat(e.session_id, '_', toString(e.page_number)) as page_id,
          e.session_id,
          e.workspace_id,
          e.path as path,
          e.landing_page as full_url,
          e.entered_at as entered_at,
          e.exited_at as exited_at,
          e.page_duration as duration,
          e.max_scroll,
          e.page_number,
          e.page_number = 1 as is_landing,
          0 as is_exit,
          if(e.page_number = 1, 'landing', 'navigation') as entry_type,
          e.user_id,
          now64(3) as received_at,
          e._version
        FROM ${workspaceDb}.events e
        WHERE e.name = 'screen_view'
      `,
    });

    // Recreate goals_mv
    await client.command({
      query: `DROP VIEW IF EXISTS ${workspaceDb}.goals_mv`,
    });
    await client.command({
      query: `
        CREATE MATERIALIZED VIEW ${workspaceDb}.goals_mv
        TO ${workspaceDb}.goals AS
        SELECT
          generateUUIDv4() as id,
          e.session_id,
          e.workspace_id,
          e.goal_name,
          e.goal_value,
          assumeNotNull(e.goal_timestamp) as goal_timestamp,
          e.path,
          e.page_number,
          e.properties,
          e.referrer,
          e.referrer_domain,
          e.is_direct,
          e.landing_page,
          e.landing_path,
          e.utm_source,
          e.utm_medium,
          e.utm_campaign,
          e.utm_term,
          e.utm_content,
          e.channel,
          e.channel_group,
          e.stm_1,
          e.stm_2,
          e.stm_3,
          e.stm_4,
          e.stm_5,
          e.stm_6,
          e.stm_7,
          e.stm_8,
          e.stm_9,
          e.stm_10,
          e.device,
          e.browser,
          e.os,
          e.country,
          e.region,
          e.city,
          e.language,
          e.browser_type,
          e.screen_width,
          e.screen_height,
          e.viewport_width,
          e.viewport_height,
          e.user_agent,
          e.connection_type,
          e.referrer_path,
          e.landing_domain,
          e.utm_id,
          e.utm_id_from,
          e.timezone,
          e.latitude,
          e.longitude,
          toYear(assumeNotNull(e.goal_timestamp)) as year,
          toMonth(assumeNotNull(e.goal_timestamp)) as month,
          toDayOfMonth(assumeNotNull(e.goal_timestamp)) as day,
          toDayOfWeek(assumeNotNull(e.goal_timestamp)) as day_of_week,
          toWeek(assumeNotNull(e.goal_timestamp)) as week_number,
          toHour(assumeNotNull(e.goal_timestamp)) as hour,
          toDayOfWeek(assumeNotNull(e.goal_timestamp)) IN (6, 7) as is_weekend,
          e.user_id,
          e._version
        FROM ${workspaceDb}.events e
        WHERE e.name = 'goal'
      `,
    });

    console.log(`[V6 Migration] Completed for ${workspaceDb}`);
  },
};
