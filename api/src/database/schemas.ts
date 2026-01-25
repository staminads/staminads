// System schemas - stored in staminads_system database
export const SYSTEM_SCHEMAS: Record<string, string> = {
  users: `
    CREATE TABLE IF NOT EXISTS {database}.users (
      id String,
      email String,
      password_hash Nullable(String),
      name String,
      type Enum8('user' = 1, 'service_account' = 2),
      status Enum8('pending' = 1, 'active' = 2, 'disabled' = 3),
      is_super_admin UInt8 DEFAULT 0,
      last_login_at Nullable(DateTime64(3)),
      failed_login_attempts UInt8 DEFAULT 0,
      locked_until Nullable(DateTime64(3)),
      password_changed_at Nullable(DateTime64(3)),
      deleted_at Nullable(DateTime64(3)),
      deleted_by Nullable(String),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id
  `,

  workspaces: `
    CREATE TABLE IF NOT EXISTS {database}.workspaces (
      id String,
      name String,
      website String,
      timezone String,
      currency String,
      logo_url Nullable(String),
      settings String DEFAULT '{}',
      status Enum8('initializing' = 1, 'active' = 2, 'inactive' = 3, 'error' = 4),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = MergeTree()
    ORDER BY id
  `,

  backfill_tasks: `
    CREATE TABLE IF NOT EXISTS {database}.backfill_tasks (
      id String,
      workspace_id String,
      status Enum8('pending' = 1, 'running' = 2, 'completed' = 3, 'failed' = 4, 'cancelled' = 5),
      lookback_days UInt16,
      chunk_size_days UInt8 DEFAULT 1,
      batch_size UInt32 DEFAULT 5000,
      total_sessions UInt64 DEFAULT 0,
      processed_sessions UInt64 DEFAULT 0,
      total_events UInt64 DEFAULT 0,
      processed_events UInt64 DEFAULT 0,
      current_date_chunk Nullable(Date),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3),
      started_at Nullable(DateTime64(3)),
      completed_at Nullable(DateTime64(3)),
      error_message String DEFAULT '',
      retry_count UInt8 DEFAULT 0,
      dimensions_snapshot String DEFAULT '[]',
      filters_snapshot String DEFAULT '[]'
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id
  `,

  audit_logs: `
    CREATE TABLE IF NOT EXISTS {database}.audit_logs (
      id String,
      user_id String,
      workspace_id Nullable(String),
      action LowCardinality(String),
      target_type LowCardinality(String),
      target_id String,
      metadata String DEFAULT '{}',
      ip_address Nullable(String),
      user_agent Nullable(String),
      created_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = MergeTree()
    PARTITION BY toYYYYMM(created_at)
    ORDER BY (created_at, user_id, id)
  `,

  workspace_memberships: `
    CREATE TABLE IF NOT EXISTS {database}.workspace_memberships (
      id String,
      workspace_id String,
      user_id String,
      role Enum8('owner' = 1, 'admin' = 2, 'editor' = 3, 'viewer' = 4),
      invited_by Nullable(String),
      joined_at DateTime64(3) DEFAULT now64(3),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (workspace_id, user_id)
  `,

  sessions: `
    CREATE TABLE IF NOT EXISTS {database}.sessions (
      id String,
      user_id String,
      token_hash String,
      ip_address Nullable(String),
      user_agent Nullable(String),
      expires_at DateTime64(3),
      revoked_at Nullable(DateTime64(3)),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (user_id, id)
  `,

  invitations: `
    CREATE TABLE IF NOT EXISTS {database}.invitations (
      id String,
      workspace_id String,
      email String,
      role Enum8('admin' = 2, 'editor' = 3, 'viewer' = 4),
      token_hash String,
      invited_by String,
      status Enum8('pending' = 1, 'accepted' = 2, 'expired' = 3, 'revoked' = 4),
      expires_at DateTime64(3),
      accepted_at Nullable(DateTime64(3)),
      revoked_at Nullable(DateTime64(3)),
      revoked_by Nullable(String),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id
  `,

  password_reset_tokens: `
    CREATE TABLE IF NOT EXISTS {database}.password_reset_tokens (
      id String,
      user_id String,
      token_hash String,
      status Enum8('pending' = 1, 'used' = 2, 'expired' = 3),
      expires_at DateTime64(3),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id
  `,

  system_settings: `
    CREATE TABLE IF NOT EXISTS {database}.system_settings (
      key String,
      value String,
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (key)
  `,

  api_keys: `
    CREATE TABLE IF NOT EXISTS {database}.api_keys (
      id String,
      key_hash String,
      key_prefix String,
      user_id String,
      workspace_id Nullable(String),
      name String,
      description String DEFAULT '',
      role Enum8('admin' = 2, 'editor' = 3, 'viewer' = 4),
      status Enum8('active' = 1, 'revoked' = 2, 'expired' = 3) DEFAULT 'active',
      expires_at Nullable(DateTime64(3)),
      last_used_at Nullable(DateTime64(3)),
      failed_attempts_count UInt8 DEFAULT 0,
      last_failed_attempt_at Nullable(DateTime64(3)),
      created_by String,
      revoked_by Nullable(String),
      revoked_at Nullable(DateTime64(3)),
      created_at DateTime64(3) DEFAULT now64(3),
      updated_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY id
  `,

  report_subscriptions: `
    CREATE TABLE IF NOT EXISTS {database}.report_subscriptions (
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
};

// Workspace schemas - stored in staminads_ws_{workspace_id} databases
// Note: workspace_id removed from ORDER BY and indexes since each database is per-workspace
export const WORKSPACE_SCHEMAS: Record<string, string> = {
  events: `
    CREATE TABLE IF NOT EXISTS {database}.events (
      id UUID DEFAULT generateUUIDv4(),
      session_id String,
      workspace_id String,
      received_at DateTime64(3),
      created_at DateTime64(3),
      updated_at DateTime64(3),
      name LowCardinality(String),
      path String,
      duration UInt64 DEFAULT 0,
      page_duration UInt32 DEFAULT 0,
      previous_path String DEFAULT '',
      referrer String DEFAULT '',
      referrer_domain String DEFAULT '',
      referrer_path String DEFAULT '',
      is_direct Bool DEFAULT false,
      landing_page String,
      landing_domain String DEFAULT '',
      landing_path String DEFAULT '',
      utm_source String DEFAULT '',
      utm_medium String DEFAULT '',
      utm_campaign String DEFAULT '',
      utm_term String DEFAULT '',
      utm_content String DEFAULT '',
      utm_id String DEFAULT '',
      utm_id_from String DEFAULT '',
      channel LowCardinality(String) DEFAULT '',
      channel_group LowCardinality(String) DEFAULT '',
      stm_1 String DEFAULT '',
      stm_2 String DEFAULT '',
      stm_3 String DEFAULT '',
      stm_4 String DEFAULT '',
      stm_5 String DEFAULT '',
      stm_6 String DEFAULT '',
      stm_7 String DEFAULT '',
      stm_8 String DEFAULT '',
      stm_9 String DEFAULT '',
      stm_10 String DEFAULT '',
      screen_width UInt16 DEFAULT 0,
      screen_height UInt16 DEFAULT 0,
      viewport_width UInt16 DEFAULT 0,
      viewport_height UInt16 DEFAULT 0,
      device String DEFAULT '',
      browser String DEFAULT '',
      browser_type String DEFAULT '',
      os String DEFAULT '',
      user_agent String DEFAULT '',
      connection_type String DEFAULT '',
      language String DEFAULT '',
      timezone String DEFAULT '',
      country LowCardinality(String) DEFAULT '',
      region LowCardinality(String) DEFAULT '',
      city String DEFAULT '',
      latitude Nullable(Float32),
      longitude Nullable(Float32),
      max_scroll UInt8 DEFAULT 0,
      page_number UInt16 DEFAULT 0,
      _version UInt64 DEFAULT 0,
      goal_name String DEFAULT '',
      goal_value Float32 DEFAULT 0,
      dedup_token String DEFAULT '',
      sdk_version String DEFAULT '',
      properties Map(String, String) DEFAULT map(),
      -- SDK timestamps (pageview)
      entered_at DateTime64(3),
      exited_at DateTime64(3),
      -- SDK timestamp (goal, null for pageviews)
      goal_timestamp Nullable(DateTime64(3)),
      -- User identification
      user_id Nullable(String),
      INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(_version)
    PARTITION BY toYYYYMMDD(received_at)
    ORDER BY (session_id, dedup_token)
    TTL toDateTime(received_at) + INTERVAL 7 DAY
  `,

  sessions: `
    CREATE TABLE IF NOT EXISTS {database}.sessions (
      id String,
      workspace_id String,
      created_at DateTime64(3),
      updated_at DateTime64(3),
      duration UInt32 DEFAULT 0,
      pageview_count UInt16 DEFAULT 1,
      median_page_duration UInt32 DEFAULT 0,
      year UInt16,
      month UInt8,
      day UInt8,
      day_of_week UInt8,
      week_number UInt8,
      hour UInt8,
      is_weekend Bool,
      referrer String DEFAULT '',
      referrer_domain String DEFAULT '',
      referrer_path String DEFAULT '',
      is_direct Bool,
      landing_page String,
      landing_domain String DEFAULT '',
      landing_path String DEFAULT '',
      exit_path String DEFAULT '',
      utm_source String DEFAULT '',
      utm_medium String DEFAULT '',
      utm_campaign String DEFAULT '',
      utm_term String DEFAULT '',
      utm_content String DEFAULT '',
      utm_id String DEFAULT '',
      utm_id_from String DEFAULT '',
      channel LowCardinality(String) DEFAULT '',
      channel_group LowCardinality(String) DEFAULT '',
      stm_1 String DEFAULT '',
      stm_2 String DEFAULT '',
      stm_3 String DEFAULT '',
      stm_4 String DEFAULT '',
      stm_5 String DEFAULT '',
      stm_6 String DEFAULT '',
      stm_7 String DEFAULT '',
      stm_8 String DEFAULT '',
      stm_9 String DEFAULT '',
      stm_10 String DEFAULT '',
      screen_width UInt16 DEFAULT 0,
      screen_height UInt16 DEFAULT 0,
      viewport_width UInt16 DEFAULT 0,
      viewport_height UInt16 DEFAULT 0,
      user_agent String DEFAULT '',
      language String DEFAULT '',
      timezone String DEFAULT '',
      country LowCardinality(String) DEFAULT '',
      region LowCardinality(String) DEFAULT '',
      city String DEFAULT '',
      latitude Nullable(Float32),
      longitude Nullable(Float32),
      browser String DEFAULT '',
      browser_type String DEFAULT '',
      os String DEFAULT '',
      device String DEFAULT '',
      connection_type String DEFAULT '',
      max_scroll UInt8 DEFAULT 0,
      goal_count UInt16 DEFAULT 0,
      goal_value Float32 DEFAULT 0,
      sdk_version String DEFAULT '',
      user_id Nullable(String),
      INDEX idx_created_at created_at TYPE minmax GRANULARITY 1,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(updated_at)
    PARTITION BY toYYYYMM(created_at)
    ORDER BY (created_at, id)
  `,

  sessions_mv: `
    CREATE MATERIALIZED VIEW IF NOT EXISTS {database}.sessions_mv
    TO {database}.sessions AS
    SELECT
      e.session_id as id,
      e.workspace_id,

      -- Use SDK timestamps (same for all events in session)
      any(e.created_at) as created_at,
      max(e.updated_at) as updated_at,
      max(e.duration) as duration,
      countIf(e.name = 'screen_view') as pageview_count,
      toUInt32(if(isNaN(medianIf(e.page_duration, e.page_duration > 0)), 0, round(medianIf(e.page_duration, e.page_duration > 0)))) as median_page_duration,

      -- Derive time dimensions from SDK created_at
      any(toYear(e.created_at)) as year,
      any(toMonth(e.created_at)) as month,
      any(toDayOfMonth(e.created_at)) as day,
      any(toDayOfWeek(e.created_at)) as day_of_week,
      any(toWeek(e.created_at)) as week_number,
      any(toHour(e.created_at)) as hour,
      any(toDayOfWeek(e.created_at) IN (6, 7)) as is_weekend,

      -- Session-level fields (same for all events)
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
    FROM {database}.events e
    GROUP BY e.session_id, e.workspace_id
  `,

  pages: `
    CREATE TABLE IF NOT EXISTS {database}.pages (
      -- Identity
      id UUID DEFAULT generateUUIDv4(),
      page_id String DEFAULT '',
      session_id String,
      workspace_id String,

      -- Page info
      path String,
      full_url String DEFAULT '',

      -- Timestamps
      entered_at DateTime64(3),
      exited_at DateTime64(3),

      -- Engagement
      duration UInt32 DEFAULT 0,
      max_scroll UInt8 DEFAULT 0,

      -- Sequence
      page_number UInt16 DEFAULT 1,
      is_landing Bool DEFAULT false,
      is_exit Bool DEFAULT false,

      -- Entry type
      entry_type LowCardinality(String) DEFAULT 'navigation',

      -- User identification
      user_id Nullable(String),

      -- Technical
      received_at DateTime64(3) DEFAULT now64(3),
      _version UInt64 DEFAULT 0,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(_version)
    PARTITION BY toYYYYMMDD(received_at)
    ORDER BY (session_id, page_number)
  `,

  pages_mv: `
    CREATE MATERIALIZED VIEW IF NOT EXISTS {database}.pages_mv
    TO {database}.pages AS
    SELECT
      generateUUIDv4() as id,
      concat(e.session_id, '_', toString(e.page_number)) as page_id,
      e.session_id,
      e.workspace_id,
      e.path as path,
      e.landing_page as full_url,
      -- Use actual SDK timestamps
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
    FROM {database}.events e
    WHERE e.name = 'screen_view'
  `,

  goals: `
    CREATE TABLE IF NOT EXISTS {database}.goals (
      id UUID DEFAULT generateUUIDv4(),
      session_id String,
      workspace_id String,

      -- Goal data
      goal_name String,
      goal_value Float32 DEFAULT 0,
      goal_timestamp DateTime64(3),
      path String,
      page_number UInt16 DEFAULT 1,
      properties Map(String, String) DEFAULT map(),

      -- Session context (for attribution)
      referrer String DEFAULT '',
      referrer_domain String DEFAULT '',
      is_direct Bool DEFAULT false,
      landing_page String,
      landing_path String DEFAULT '',
      utm_source String DEFAULT '',
      utm_medium String DEFAULT '',
      utm_campaign String DEFAULT '',
      utm_term String DEFAULT '',
      utm_content String DEFAULT '',
      channel LowCardinality(String) DEFAULT '',
      channel_group LowCardinality(String) DEFAULT '',
      stm_1 String DEFAULT '',
      stm_2 String DEFAULT '',
      stm_3 String DEFAULT '',
      stm_4 String DEFAULT '',
      stm_5 String DEFAULT '',
      stm_6 String DEFAULT '',
      stm_7 String DEFAULT '',
      stm_8 String DEFAULT '',
      stm_9 String DEFAULT '',
      stm_10 String DEFAULT '',
      device String DEFAULT '',
      browser String DEFAULT '',
      os String DEFAULT '',
      country LowCardinality(String) DEFAULT '',
      region LowCardinality(String) DEFAULT '',
      city String DEFAULT '',
      language String DEFAULT '',

      -- Additional device info (aligned with sessions)
      browser_type String DEFAULT '',
      screen_width UInt16 DEFAULT 0,
      screen_height UInt16 DEFAULT 0,
      viewport_width UInt16 DEFAULT 0,
      viewport_height UInt16 DEFAULT 0,
      user_agent String DEFAULT '',
      connection_type String DEFAULT '',

      -- Additional traffic (aligned with sessions)
      referrer_path String DEFAULT '',
      landing_domain String DEFAULT '',

      -- Additional UTM (aligned with sessions)
      utm_id String DEFAULT '',
      utm_id_from String DEFAULT '',

      -- Additional geo (aligned with sessions)
      timezone String DEFAULT '',
      latitude Nullable(Float32),
      longitude Nullable(Float32),

      -- Time dimensions (computed from goal_timestamp)
      year UInt16,
      month UInt8,
      day UInt8,
      day_of_week UInt8,
      week_number UInt8,
      hour UInt8,
      is_weekend Bool,

      -- User identification
      user_id Nullable(String),

      -- Technical
      _version UInt64 DEFAULT 0,
      INDEX idx_goal_timestamp goal_timestamp TYPE minmax GRANULARITY 1,
      INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(_version)
    PARTITION BY toYYYYMM(goal_timestamp)
    ORDER BY (goal_timestamp, session_id, goal_name)
  `,

  goals_mv: `
    CREATE MATERIALIZED VIEW IF NOT EXISTS {database}.goals_mv
    TO {database}.goals AS
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

      -- Additional device info
      e.browser_type,
      e.screen_width,
      e.screen_height,
      e.viewport_width,
      e.viewport_height,
      e.user_agent,
      e.connection_type,

      -- Additional traffic
      e.referrer_path,
      e.landing_domain,

      -- Additional UTM
      e.utm_id,
      e.utm_id_from,

      -- Additional geo
      e.timezone,
      e.latitude,
      e.longitude,

      -- Computed time dimensions
      toYear(assumeNotNull(e.goal_timestamp)) as year,
      toMonth(assumeNotNull(e.goal_timestamp)) as month,
      toDayOfMonth(assumeNotNull(e.goal_timestamp)) as day,
      toDayOfWeek(assumeNotNull(e.goal_timestamp)) as day_of_week,
      toWeek(assumeNotNull(e.goal_timestamp)) as week_number,
      toHour(assumeNotNull(e.goal_timestamp)) as hour,
      toDayOfWeek(assumeNotNull(e.goal_timestamp)) IN (6, 7) as is_weekend,

      e.user_id,
      e._version
    FROM {database}.events e
    WHERE e.name = 'goal'
  `,
};
