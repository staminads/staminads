# Web Session Data Flow Architecture

This document provides a comprehensive deep-dive into how web session data flows through the Staminads analytics platform, from SDK ingestion to analytics reports.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [SDK Ingestion](#sdk-ingestion)
3. [Data Transformations](#data-transformations)
4. [Event Buffering & Batching](#event-buffering--batching)
5. [Database Architecture](#database-architecture)
6. [Database Optimization Strategies](#database-optimization-strategies)
7. [Materialized Views & Aggregations](#materialized-views--aggregations)
8. [Filter System & Backfill Mechanism](#filter-system--backfill-mechanism)
9. [Analytics Query Execution](#analytics-query-execution)
10. [Data Flow Diagram](#data-flow-diagram)

---

## Architecture Overview

Staminads is a multi-tenant web analytics platform built on ClickHouse for high-performance time-series data storage and querying. The architecture follows these core principles:

- **Database-per-tenant isolation**: Each workspace has its own ClickHouse database
- **Real-time ingestion with buffering**: Events are buffered per-workspace before batch insertion
- **Materialized aggregations**: Sessions are auto-computed from events via materialized views
- **Privacy by design**: IP addresses are never stored; only geo-lookup results are persisted
- **Lazy backfilling**: Historical data is only re-processed when filter configurations change

### High-Level Flow

```
SDK → Track Endpoint → Event Processing → Buffer → ClickHouse Events Table
                                                           ↓
                                                   Materialized View
                                                           ↓
                                                   Sessions Table
                                                           ↓
                                                   Analytics Queries
```

---

## SDK Ingestion

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/track` | POST | Track session with cumulative actions array |

**Source**: `api/src/events/events.controller.ts`

### Session Payload Data Model

The SDK sends session payloads conforming to `SessionPayloadDto`. This uses a checkpoint-based delta sending pattern where actions are processed incrementally:

```typescript
interface SessionPayloadDto {
  // Identifiers
  workspace_id: string;      // Workspace identifier
  session_id: string;        // Client-generated session ID

  // Actions array (pageviews and goals)
  actions: (PageviewActionDto | GoalActionDto)[];

  // Current page being viewed (optional)
  current_page?: CurrentPageDto;

  // Checkpoint for incremental processing
  checkpoint?: number;       // Server skips actions at indices <= checkpoint

  // Session attributes (traffic source, device info)
  attributes?: SessionAttributesDto;

  // Timestamps
  created_at: number;        // Session start (unix ms)
  updated_at: number;        // Last interaction (unix ms)

  // SDK metadata
  sdk_version?: string;
  sent_at?: number;          // For clock skew detection
}

interface PageviewActionDto {
  type: 'pageview';
  path: string;              // Page path
  page_number: number;       // Sequence within session (1-based)
  duration: number;          // Time on page (ms)
  scroll: number;            // Max scroll depth (0-100)
  entered_at: number;        // When user entered page (unix ms)
  exited_at: number;         // When user exited page (unix ms)
}

interface GoalActionDto {
  type: 'goal';
  name: string;              // Goal identifier
  path: string;              // Page where goal triggered
  page_number: number;       // Page sequence number
  timestamp: number;         // When goal triggered (unix ms)
  value?: number;            // Optional goal value
  properties?: Record<string, string>;  // Custom properties
}

interface SessionAttributesDto {
  // Traffic source
  referrer?: string;         // Full referrer URL
  landing_page: string;      // Landing page URL

  // UTM parameters
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
  utm_id_from?: string;

  // Device information
  device?: string;           // "desktop", "mobile", "tablet"
  browser?: string;          // Browser name
  browser_type?: string;     // "human" or "bot"
  os?: string;               // Operating system
  user_agent?: string;       // Full user agent string
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  connection_type?: string;  // "4g", "wifi", etc.

  // User locale
  language?: string;         // Browser language
  timezone?: string;         // User timezone (IANA format)
}
```

**Source**: `api/src/events/dto/session-payload.dto.ts`

### Client IP Handling

The client IP is extracted via the `@ClientIp()` decorator but is **never stored**. It is used exclusively for geo-location lookup, after which only the geo results are persisted.

---

## Data Transformations

### Processing Pipeline

When a session payload is received, it undergoes the following transformations in `SessionPayloadHandler.handle()`:

**Source**: `api/src/events/session-payload.handler.ts`

#### 1. Workspace Configuration Loading

```typescript
// Workspace config is cached for 1 minute (CACHE_TTL_MS = 60 * 1000)
const workspace = await this.getWorkspace(payload.workspace_id);
// Config includes: filters, geo_settings, allowed_domains, timezone
```

- Workspace settings are cached in-memory for 1 minute
- Cache is invalidated via event emitter when filters or settings change

#### 2. Geo-Location Lookup

**Source**: `api/src/geo/geo.service.ts`

The geo service uses MaxMind GeoLite2 database:

```typescript
// IP → Geo lookup with workspace settings (results cached 5 min, max 10,000 entries)
const geo = this.geoService.lookupWithSettings(clientIp, {
  geo_enabled: workspace.settings.geo_enabled,
  geo_store_city: workspace.settings.geo_store_city,
  geo_store_region: workspace.settings.geo_store_region,
  geo_coordinates_precision: workspace.settings.geo_coordinates_precision,
});

// Geo result structure
interface GeoLocation {
  country: string | null;    // ISO country code
  region: string | null;     // State/province
  city: string | null;       // City name
  latitude: number | null;   // Coordinates (precision configurable)
  longitude: number | null;
}
```

**Privacy controls** (per-workspace):
- `geo_enabled`: Enable/disable geo lookup entirely
- `geo_store_city`: Whether to store city-level data
- `geo_store_region`: Whether to store region-level data
- `geo_coordinates_precision`: Decimal precision for lat/long (0-2)

#### 3. URL Parsing

Referrer and landing page URLs are parsed to extract components:

```typescript
// Input: referrer = "https://google.com/search?q=analytics"
// Output:
referrer_domain = "google.com"
referrer_path = "/search"

// Input: landing_page = "https://example.com/products/widget"
// Output:
landing_domain = "example.com"
landing_path = "/products/widget"
```

#### 4. Filter Evaluation (Real-time)

**Source**: `api/src/filters/lib/filter-evaluator.ts`

Filters are evaluated **before** events are buffered/stored:

```typescript
interface FilterDefinition {
  id: string;
  name: string;
  priority: number;           // 0-1000, higher = evaluated first
  order: number;              // UI display order (drag-drop)
  tags: string[];             // e.g., ["channel", "marketing", "paid"]
  conditions: FilterCondition[];  // All conditions must match (AND logic)
  operations: FilterOperation[];
  enabled: boolean;
  version: string;            // Hash for staleness detection
  createdAt: string;
  updatedAt: string;
}

interface FilterCondition {
  field: string;              // e.g., "utm_source", "referrer_domain"
  operator: FilterOperator;   // Comparison type
  value?: string;             // Value to match (optional for is_empty/is_not_empty)
}

type FilterOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'is_empty' | 'is_not_empty'
  | 'regex';                  // RE2 syntax (ClickHouse compatible)

interface FilterOperation {
  dimension: string;          // "channel", "stm_1"-"stm_10", UTM fields, etc.
  action: FilterAction;       // Operation type
  value?: string;             // Value to set (required for set_value/set_default_value)
}

type FilterAction = 'set_value' | 'unset_value' | 'set_default_value';
```

**Operation semantics**:
- `set_value`: Always set the dimension (higher priority filter wins)
- `unset_value`: Clear the dimension value (set to empty string)
- `set_default_value`: Set only if dimension is currently null/empty

**Writable dimensions**: `channel`, `channel_group`, `stm_1`-`stm_10`, UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`), `referrer_domain`, `is_direct`

**Source fields for conditions**: UTM parameters, `referrer`, `referrer_domain`, `referrer_path`, `is_direct`, `landing_page`, `landing_domain`, `landing_path`, `path`, `device`, `browser`, `browser_type`, `os`, `user_agent`, `connection_type`, `language`, `timezone`

---

## Event Buffering & Batching

### Buffer Architecture

**Source**: `api/src/events/event-buffer.service.ts`

Events are buffered per-workspace before batch insertion:

```typescript
class EventBufferService {
  private buffers: Map<string, EventEntity[]>;  // workspace_id → events

  // Configuration
  BUFFER_SIZE = 500;      // Max events before flush
  FLUSH_INTERVAL = 2000;  // Flush every 2 seconds
}
```

### Flush Triggers

1. **Size-based**: Buffer reaches 500 events
2. **Time-based**: 2 seconds elapsed with pending events
3. **Graceful shutdown**: All buffers flushed on `onModuleDestroy`

### Error Handling

```typescript
async flush(workspaceId: string): Promise<void> {
  try {
    await this.clickhouse.insertWorkspace(workspaceId, events);
  } catch (error) {
    // Re-add failed events to front of buffer for retry
    this.buffers.set(workspaceId, [...events, ...remaining]);
    throw error;
  }
}
```

---

## Database Architecture

### Multi-Tenant Design

```
ClickHouse Instance
├── staminads_system              # System database (shared)
│   ├── workspaces                # Workspace metadata
│   └── backfill_tasks            # Backfill task tracking
│
├── staminads_ws_{workspace_1}    # Workspace 1 database
│   ├── events                    # Raw events
│   ├── sessions                  # Aggregated sessions
│   └── sessions_mv               # Materialized view
│
└── staminads_ws_{workspace_n}    # Workspace N database
    ├── events
    ├── sessions
    └── sessions_mv
```

**Benefits**:
- Complete data isolation between workspaces
- Independent scaling and maintenance
- Simplified access control
- Easy workspace deletion (DROP DATABASE)

### Events Table Schema

**Source**: `api/src/database/schemas.ts`

```sql
CREATE TABLE events (
  -- Identifiers
  id UUID DEFAULT generateUUIDv4(),
  session_id String,
  workspace_id String,
  received_at DateTime64(3),      -- Server receive time (used for partitioning/TTL)
  created_at DateTime64(3),       -- SDK timestamp (session start)
  updated_at DateTime64(3),       -- SDK timestamp (event time)

  -- Event metadata
  name LowCardinality(String),    -- 'screen_view' or 'goal'
  path String,
  duration UInt64,                -- Session duration at this event
  page_duration UInt32,           -- Time spent on previous page (ms)
  previous_path String,           -- Path of previous page
  page_number UInt16,             -- Page sequence number

  -- Traffic source
  referrer String,
  referrer_domain String,
  referrer_path String,
  is_direct Bool,

  -- Landing page
  landing_page String,
  landing_domain String,
  landing_path String,

  -- UTM parameters
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  utm_id String,
  utm_id_from String,

  -- Channel classification (set by filters)
  channel LowCardinality(String),
  channel_group LowCardinality(String),

  -- Custom dimensions (set by filters)
  stm_1 String, stm_2 String, ..., stm_10 String,

  -- Device information
  screen_width UInt16,
  screen_height UInt16,
  viewport_width UInt16,
  viewport_height UInt16,
  device String,
  browser String,
  browser_type String,
  os String,
  user_agent String,
  connection_type String,

  -- User locale
  language String,
  timezone String,

  -- Geo location
  country LowCardinality(String),
  region LowCardinality(String),
  city String,
  latitude Nullable(Float32),
  longitude Nullable(Float32),

  -- Engagement
  max_scroll UInt8,

  -- Goals (for goal events)
  goal_name String,
  goal_value Float32,
  goal_timestamp Nullable(DateTime64(3)),

  -- Technical
  _version UInt64,
  dedup_token String,
  sdk_version String,
  properties Map(String, String),

  -- SDK timestamps (pageview boundaries)
  entered_at DateTime64(3),
  exited_at DateTime64(3),

  -- Indexes
  INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (session_id, received_at)
TTL toDateTime(received_at) + INTERVAL 7 DAY
```

### Sessions Table Schema

**Source**: `api/src/database/schemas.ts`

```sql
CREATE TABLE sessions (
  -- Identifiers
  id String,                      -- Same as session_id
  workspace_id String,
  created_at DateTime64(3),       -- First event timestamp
  updated_at DateTime64(3),       -- Last event timestamp

  -- Computed metrics
  duration UInt32,                -- Session duration (seconds)
  pageview_count UInt16,          -- Number of page views
  median_page_duration UInt32,    -- Median time per page (ms)

  -- Time components (for efficient grouping)
  year UInt16,
  month UInt8,
  day UInt8,
  day_of_week UInt8,
  week_number UInt8,
  hour UInt8,
  is_weekend Bool,

  -- Session attributes (from first event)
  referrer String,
  referrer_domain String,
  referrer_path String,
  is_direct Bool,
  landing_page String,
  landing_domain String,
  landing_path String,
  exit_path String,               -- Last page viewed

  -- UTM (from first event)
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  utm_id String,
  utm_id_from String,

  -- Channels (set by filters)
  channel LowCardinality(String),
  channel_group LowCardinality(String),

  -- Custom dimensions (set by filters)
  stm_1 String, ..., stm_10 String,

  -- Device (any value from session)
  screen_width UInt16,
  screen_height UInt16,
  viewport_width UInt16,
  viewport_height UInt16,
  user_agent String,
  language String,
  timezone String,
  country LowCardinality(String),
  region LowCardinality(String),
  city String,
  latitude Nullable(Float32),
  longitude Nullable(Float32),
  browser String,
  browser_type String,
  os String,
  device String,
  connection_type String,

  -- Engagement
  max_scroll UInt8,
  goal_count UInt16,              -- Number of goals triggered
  goal_value Float32,             -- Total goal value

  sdk_version String,
  INDEX idx_created_at created_at TYPE minmax GRANULARITY 1
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, id)
```

### Pages Table Schema

**Source**: `api/src/database/schemas.ts`

```sql
CREATE TABLE pages (
  -- Identity
  id UUID DEFAULT generateUUIDv4(),
  page_id String,                 -- session_id + page_number
  session_id String,
  workspace_id String,

  -- Page info
  path String,
  full_url String,

  -- Timestamps
  entered_at DateTime64(3),
  exited_at DateTime64(3),

  -- Engagement
  duration UInt32,                -- Time on page (ms)
  max_scroll UInt8,               -- Max scroll depth (0-100)

  -- Sequence
  page_number UInt16,
  is_landing Bool,
  is_exit Bool,
  entry_type LowCardinality(String),  -- 'landing' or 'navigation'

  -- Technical
  received_at DateTime64(3),
  _version UInt64
)
ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (session_id, page_number)
```

### Goals Table Schema

**Source**: `api/src/database/schemas.ts`

```sql
CREATE TABLE goals (
  id UUID DEFAULT generateUUIDv4(),
  session_id String,
  workspace_id String,

  -- Goal data
  goal_name String,
  goal_value Float32,
  goal_timestamp DateTime64(3),
  path String,
  page_number UInt16,
  properties Map(String, String),

  -- Session context (for attribution)
  referrer String,
  referrer_domain String,
  is_direct Bool,
  landing_page String,
  landing_path String,
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  channel LowCardinality(String),
  channel_group LowCardinality(String),
  stm_1 String, ..., stm_10 String,
  device String,
  browser String,
  os String,
  country LowCardinality(String),
  region LowCardinality(String),
  city String,
  language String,

  -- Technical
  _version UInt64,
  INDEX idx_goal_timestamp goal_timestamp TYPE minmax GRANULARITY 1
)
ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMM(goal_timestamp)
ORDER BY (goal_timestamp, session_id, goal_name)
```

---

## Database Optimization Strategies

### 1. Table Engine Selection

| Table | Engine | Rationale |
|-------|--------|-----------|
| `events` | MergeTree | Append-heavy workload, short TTL (7 days) |
| `sessions` | ReplacingMergeTree | Updates via materialized view aggregation |
| `pages` | ReplacingMergeTree | Updates via materialized view, dedup by _version |
| `goals` | ReplacingMergeTree | Updates via materialized view, dedup by _version |
| `workspaces` | MergeTree | Workspace config (system table) |
| `backfill_tasks` | ReplacingMergeTree | Status updates during processing |

**ReplacingMergeTree** handles updates by:
1. Inserting new rows with updated values
2. Background merging keeps latest version (by `updated_at`)
3. Query time: `FINAL` modifier ensures deduplication

### 2. Partitioning Strategy

| Table | Partition Key | Partition Size | Rationale |
|-------|---------------|----------------|-----------|
| `events` | `toYYYYMMDD(received_at)` | Daily | Fine-grained pruning, TTL drops whole partitions |
| `sessions` | `toYYYYMM(created_at)` | Monthly | Coarser for longer retention, fewer partitions |
| `pages` | `toYYYYMMDD(received_at)` | Daily | Aligned with events for consistency |
| `goals` | `toYYYYMM(goal_timestamp)` | Monthly | Long retention for conversion analysis |

**Benefits**:
- **Query optimization**: ClickHouse skips irrelevant partitions
- **Backfill efficiency**: Process one partition at a time
- **Maintenance**: Easy partition dropping for data retention

### 3. Primary Key (ORDER BY) Design

**Events table**: `ORDER BY (session_id, received_at)`

```sql
-- Optimized queries:
-- 1. Get all events for a session
SELECT * FROM events WHERE session_id = 'abc123' ORDER BY received_at;

-- 2. Get events in time range within a session
SELECT * FROM events
WHERE session_id = 'abc123'
  AND received_at BETWEEN '2024-01-01' AND '2024-01-02';
```

**Sessions table**: `ORDER BY (created_at, id)`

```sql
-- Optimized queries:
-- 1. Time-range analytics
SELECT utm_source, count() FROM sessions
WHERE created_at >= '2024-01-01' GROUP BY utm_source;

-- 2. Specific session lookup
SELECT * FROM sessions WHERE id = 'abc123';
```

### 4. Index Strategy

```sql
-- Bloom filter index for event name filtering
INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1
-- False positive rate: 1%
-- Used for: WHERE name = 'pageview'

-- Set index for low-cardinality column
INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1
-- Max 10 unique values tracked per granule
-- Used for: WHERE browser_type = 'human'
```

**When to use each index type**:
- **bloom_filter**: High cardinality, equality checks
- **set**: Low cardinality (< 100 unique values)
- **minmax**: Range queries on numeric/date columns

### 5. Data Type Optimization

| Pattern | Data Type | Example Fields |
|---------|-----------|----------------|
| Few unique values | `LowCardinality(String)` | country, region, channel, browser_type |
| Unbounded text | `String` | path, referrer, user_agent |
| Small numbers | `UInt8` | max_scroll (0-100), month (1-12) |
| Medium numbers | `UInt16` | screen dimensions, year |
| Large numbers | `UInt64` | duration (ms) |
| Timestamps | `DateTime64(3)` | created_at (ms precision) |
| Optional values | `Nullable(Type)` | latitude, longitude |

**LowCardinality optimization**:
- Dictionary encoding for repeated values
- Typically 10x compression improvement
- Faster GROUP BY and filtering

### 6. TTL (Time-to-Live)

```sql
-- Events auto-deleted after 7 days
TTL toDateTime(received_at) + INTERVAL 7 DAY
```

**Rationale**:
- Raw events are only needed for recent analysis
- Sessions table retains aggregated data longer
- Reduces storage costs significantly
- Backfill processor respects TTL boundary

---

## Materialized Views & Aggregations

### Table Flow Overview

```
                           ┌─────────────────┐
                           │   SDK Tracker   │
                           │  (POST /track)  │
                           └────────┬────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │  events table   │  ← Raw event data inserted
                           │   (MergeTree)   │
                           │  TTL: 7 days    │
                           └────────┬────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ sessions_mv │ │  pages_mv   │ │  goals_mv   │
            │    (MV)     │ │    (MV)     │ │    (MV)     │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  sessions   │ │   pages     │ │   goals     │
            │ (Replacing) │ │ (Replacing) │ │ (Replacing) │
            │  No TTL     │ │  No TTL     │ │  No TTL     │
            └─────────────┘ └─────────────┘ └─────────────┘
```

### Table Summary

| Table | Engine | Populated By | Data Stored | TTL |
|-------|--------|--------------|-------------|-----|
| **events** | MergeTree | Direct INSERT from `/track` | Every pageview/goal event with full context | 7 days |
| **sessions** | ReplacingMergeTree | `sessions_mv` (aggregates events) | Session-level metrics + attribution | None |
| **pages** | ReplacingMergeTree | `pages_mv` (filters screen_view events) | Page engagement (duration, scroll) | None |
| **goals** | ReplacingMergeTree | `goals_mv` (filters goal events) | Goal conversions with session context | None |

### What Each MV Does

- **sessions_mv**: Groups events by `session_id`, computes duration, pageview count, median page duration, and extracts session-level attribution fields
- **pages_mv**: Extracts from `screen_view` events where `page_duration > 0` - captures page path, timestamps, duration, scroll depth
- **goals_mv**: Extracts from `goal` events - captures goal name/value/timestamp with full session attribution context

### Backfill Impact

The filter backfill system updates tables with classifiable dimensions:

```
Backfill (filter rules)
         │
         ├──► UPDATE events   (only last 7 days due to TTL)
         │
         ├──► UPDATE sessions (full history, no TTL)
         │
         └──► UPDATE goals    (full history, no TTL)

         ✗ pages   - no classifiable dimensions (channel, stm_*, utm_*)
```

### Sessions Materialized View

**Source**: `api/src/database/schemas.ts` (sessions_mv creation)

The sessions MV aggregates events per session. Since the SDK sends all events with identical session-level attributes (referrer, UTM, etc.), the MV uses `any()` for most fields. Only `exit_path` needs `argMax` to get the last page viewed.

```sql
CREATE MATERIALIZED VIEW sessions_mv TO sessions AS
SELECT
  e.session_id as id,
  e.workspace_id,

  -- Timestamps (SDK timestamps are same for all events in session)
  any(e.created_at) as created_at,
  max(e.updated_at) as updated_at,
  max(e.duration) as duration,

  -- Pageview and engagement metrics
  countIf(e.name = 'screen_view') as pageview_count,
  toUInt32(if(isNaN(medianIf(e.page_duration, e.page_duration > 0)), 0,
    round(medianIf(e.page_duration, e.page_duration > 0)))) as median_page_duration,

  -- Time components (derived from SDK created_at)
  any(toYear(e.created_at)) as year,
  any(toMonth(e.created_at)) as month,
  any(toDayOfMonth(e.created_at)) as day,
  any(toDayOfWeek(e.created_at)) as day_of_week,
  any(toWeek(e.created_at)) as week_number,
  any(toHour(e.created_at)) as hour,
  any(toDayOfWeek(e.created_at) IN (6, 7)) as is_weekend,

  -- Session-level fields (same for all events in session)
  any(e.referrer) as referrer,
  any(e.referrer_domain) as referrer_domain,
  any(e.referrer_path) as referrer_path,
  any(e.is_direct) as is_direct,
  any(e.landing_page) as landing_page,
  any(e.landing_domain) as landing_domain,
  any(e.landing_path) as landing_path,
  argMax(e.path, e.updated_at) as exit_path,  -- Last page viewed

  -- UTM (same for all events in session)
  any(e.utm_source) as utm_source,
  any(e.utm_medium) as utm_medium,
  any(e.utm_campaign) as utm_campaign,
  any(e.utm_term) as utm_term,
  any(e.utm_content) as utm_content,
  any(e.utm_id) as utm_id,
  any(e.utm_id_from) as utm_id_from,

  -- Channels (same for all events in session)
  any(e.channel) as channel,
  any(e.channel_group) as channel_group,

  -- Custom dimensions (same for all events in session)
  any(e.stm_1) as stm_1,
  -- ... stm_2 through stm_10 ...

  -- Device info (constant per session)
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

  -- Engagement metrics
  max(e.max_scroll) as max_scroll,
  countIf(e.name = 'goal') as goal_count,
  sumIf(e.goal_value, e.name = 'goal') as goal_value,

  any(e.sdk_version) as sdk_version

FROM events e
GROUP BY e.session_id, e.workspace_id
```

### Aggregation Functions Explained

| Function | Usage | Behavior |
|----------|-------|----------|
| `any(field)` | Session-level fields | Any value (SDK sends identical values for all events) |
| `max(updated_at)` | Session end | Latest event timestamp |
| `max(duration)` | Session duration | Maximum cumulative duration |
| `argMax(path, updated_at)` | Exit path | Last page viewed (by timestamp) |
| `countIf(condition)` | Pageviews/goals | Count events matching condition |
| `sumIf(field, condition)` | Goal value | Sum values where condition matches |
| `medianIf(field, condition)` | Page duration | Median of non-zero values |
| `max(max_scroll)` | Peak engagement | Maximum scroll depth reached |

### How It Works

1. **Event inserted** → Materialized view query executes
2. **New session_id** → New row inserted into sessions
3. **Existing session_id** → New row inserted (ReplacingMergeTree handles merging)
4. **Background merges** → Duplicate session rows consolidated

**Important**: Session data may be temporarily duplicated until merge. Use `FINAL` modifier or application-level deduplication for exact counts.

---

## Filter System & Backfill Mechanism

### Filter Architecture

Filters classify incoming events and can set dimension values based on conditions.

**Source files**:
- `api/src/filters/lib/filter-evaluator.ts` - Real-time evaluation
- `api/src/filters/lib/filter-compiler.ts` - SQL compilation for backfill
- `api/src/filters/backfill/backfill.processor.ts` - Backfill execution

### Filter Data Model

```typescript
interface FilterDefinition {
  id: string;
  name: string;
  priority: number;              // 0-1000, higher = evaluated first
  order: number;                 // UI display order
  tags: string[];                // Classification tags
  conditions: FilterCondition[];
  operations: FilterOperation[];
  enabled: boolean;
  version: string;               // Hash for staleness detection
  createdAt: string;
  updatedAt: string;
}

interface FilterCondition {
  field: string;                 // Source field to check
  operator: FilterOperator;      // Comparison type
  value?: string;                // Value to match (optional for is_empty/is_not_empty)
}

type FilterOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'is_empty' | 'is_not_empty'
  | 'regex';                     // RE2 syntax (ClickHouse compatible)

interface FilterOperation {
  dimension: string;             // Target dimension
  action: FilterAction;          // Operation type
  value?: string;                // Value to set (required for set_value/set_default_value)
}

type FilterAction = 'set_value' | 'unset_value' | 'set_default_value';
```

### Real-time Evaluation Flow

```
Event received
    ↓
Load workspace filters (sorted by priority DESC)
    ↓
For each filter:
    ├─ Evaluate all conditions (AND logic)
    ├─ If all conditions match:
    │   └─ Execute operations
    │       ├─ set_value: dimension = value
    │       ├─ unset_value: dimension = null
    │       └─ set_default_value: if dimension is null, set value
    └─ Continue to next filter
    ↓
Event ready for buffering
```

### Backfill Mechanism

When filters are modified, historical data must be re-classified:

**Source**: `api/src/filters/backfill/backfill.processor.ts`

#### 1. Backfill Task Creation

```typescript
interface BackfillTask {
  id: string;
  workspace_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  filter_snapshot: string;       // JSON of filters at task creation
  lookback_days: number;         // How far back to process
  chunk_size_days: number;       // Days per processing chunk
  total_sessions: number;
  processed_sessions: number;
  total_events: number;
  processed_events: number;
  error_message?: string;
  created_at: DateTime;
  updated_at: DateTime;
}
```

#### 2. Validation Phase

Before any mutations, filters are validated:

```typescript
// 1. Check regex patterns are valid RE2 (ClickHouse's regex engine)
// 2. Validate field names exist
// 3. Validate dimension names
// 4. Check operation types are valid
```

**RE2 vs PCRE differences**:
- No backreferences (`\1`, `\2`)
- No lookahead/lookbehind (`(?=...)`, `(?!...)`)
- No possessive quantifiers (`*+`, `++`)
- Different escape sequences

#### 3. SQL Compilation

**Source**: `api/src/filters/lib/filter-compiler.ts`

Filters are compiled to ClickHouse SQL:

```sql
-- Example compiled UPDATE for a single partition
ALTER TABLE events UPDATE
  channel = CASE
    WHEN (utm_source = 'google' AND utm_medium = 'cpc') THEN 'Paid Search'
    WHEN (referrer_domain LIKE '%google%') THEN 'Organic Search'
    ELSE channel  -- Keep existing value
  END,
  stm_1 = CASE
    WHEN (path LIKE '/products/%') THEN 'Product Page'
    ELSE stm_1
  END
IN PARTITION '20240115'  -- Process one day at a time
WHERE 1=1
```

#### 4. Date Chunking

```typescript
// Process data in daily chunks
for (date of dateRange(startDate, endDate)) {
  // Only process events within TTL (7 days)
  if (date >= ttlBoundary) {
    await executeMutation(workspaceId, date, compiledSql);
  }
  updateProgress(task);
}
```

#### 5. Concurrency Control

```typescript
import { Semaphore } from 'async-mutex';

// Global semaphore for mutation capacity coordination across all backfill processors
// Soft limit: 80 concurrent mutations (gates burst submission, not total capacity)
const GLOBAL_MUTATION_SEMAPHORE = new Semaphore(80);
// Hard limit: ClickHouse's actual capacity (leave headroom for system mutations)
const CLICKHOUSE_HARD_LIMIT = 95;

class BackfillProcessor {
  // Per-workspace locking (only ONE backfill per workspace at a time)
  private static workspaceLocks: Map<string, Promise<void>>;

  /**
   * Acquire a mutation slot using global semaphore coordination.
   *
   * Design principles:
   * - Semaphore gates SUBMISSION burst, not total capacity
   * - Release semaphore IMMEDIATELY after check (don't hold during mutation execution)
   * - Pre-check and post-check ClickHouse capacity for fail-fast and race protection
   */
  async acquireMutationSlot(): Promise<void> {
    // Pre-check: fail fast if ClickHouse is already overloaded
    const preCheck = await this.getGlobalMutationCount();
    if (preCheck >= CLICKHOUSE_HARD_LIMIT) {
      throw new Error(`ClickHouse mutation queue full (${preCheck}/${CLICKHOUSE_HARD_LIMIT})`);
    }

    // Acquire semaphore with timeout (60s)
    const [, release] = await GLOBAL_MUTATION_SEMAPHORE.acquire();

    try {
      // Double-check after acquiring (race protection)
      const postCheck = await this.getGlobalMutationCount();
      if (postCheck >= CLICKHOUSE_HARD_LIMIT) {
        throw new Error(`ClickHouse mutation queue full`);
      }
    } finally {
      // Release semaphore IMMEDIATELY - don't hold during mutation execution
      release();
    }
  }

  private async getGlobalMutationCount(): Promise<number> {
    // Query ALL running mutations (not just this workspace)
    const result = await clickhouse.query(
      `SELECT count() FROM system.mutations WHERE is_done = 0`
    );
    return parseInt(result[0]?.count ?? '0', 10);
  }
}
```

**Key design decisions:**
- **Soft limit (80)**: Semaphore gates burst submission to prevent thundering herd
- **Hard limit (95)**: ClickHouse actual capacity check (leave 5 for system mutations)
- **Immediate release**: Semaphore released after check, not held during mutation execution
- **Two-phase check**: Pre-check (fail fast) + post-check (race protection)

#### 6. Progress Tracking

```sql
-- Track progress in backfill_tasks table
INSERT INTO backfill_tasks (
  id, workspace_id, status,
  total_sessions, processed_sessions,
  total_events, processed_events,
  updated_at
) VALUES (...)
```

#### 7. Error Recovery

```typescript
// On service restart, recover stale tasks
async recoverStaleTasks(): Promise<void> {
  const staleTasks = await this.findTasks({
    status: 'running',
    updated_at: { $lt: fiveMinutesAgo }
  });

  for (const task of staleTasks) {
    // Kill any active mutations
    await this.killMutations(task.workspace_id);
    // Resume from last checkpoint
    await this.resumeTask(task);
  }
}
```

### Staleness Detection

Staleness is detected by comparing the current filter configuration hash with the snapshot stored in the last completed backfill task:

```typescript
// Current filter version
const currentVersion = computeFilterVersion(workspace.filters);

// Compare with last backfill snapshot
const lastBackfill = await getLastCompletedBackfillTask(workspaceId);
const lastVersion = lastBackfill
  ? computeFilterVersion(JSON.parse(lastBackfill.filters_snapshot))
  : null;

const needsBackfill = currentVersion !== lastVersion;
```

This enables the UI to show a simple "Backfill needed" indicator when filters have changed since the last backfill.

---

## Analytics Query Execution

### Query Architecture

**Source files**:
- `api/src/analytics/analytics.controller.ts` - Endpoints
- `api/src/analytics/analytics.service.ts` - Query execution
- `api/src/analytics/lib/query-builder.ts` - SQL generation
- `api/src/analytics/lib/filter-builder.ts` - WHERE clause generation

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics.query` | POST | Execute analytics query |
| `/api/analytics.extremes` | POST | Get min/max of metric |
| `/api/analytics.metrics` | GET | List available metrics |
| `/api/analytics.dimensions` | GET | List available dimensions |

### Available Metrics

**Source**: `api/src/analytics/constants/metrics.ts`

Metrics are scoped by table. The `sessions` table supports session-level metrics, `pages` supports per-page metrics, and `goals` supports conversion metrics.

| Metric | SQL Expression | Table | Description |
|--------|----------------|-------|-------------|
| `sessions` | `count()` | sessions | Number of sessions |
| `avg_duration` | `round(avg(duration), 1)` | sessions | Average session duration (seconds) |
| `median_duration` | `round(median(duration), 1)` | sessions | Median session duration (seconds) |
| `max_scroll` | `round(avg(max_scroll), 1)` | sessions | Average max scroll depth (%) |
| `median_scroll` | `round(median(max_scroll), 1)` | sessions | Median max scroll depth (%) |
| `bounce_rate` | `countIf(duration < {threshold}) * 100.0 / count()` | sessions | Bounce rate (configurable threshold) |
| `pages_per_session` | `round(avg(pageview_count), 2)` | sessions | Average pages per session |
| `page_count` | `count()` | pages | Total page views |
| `page_duration` | `round(median(duration), 1)` | pages | Median time on page (seconds) |
| `page_scroll` | `round(median(max_scroll), 1)` | pages | Median scroll depth (%) |
| `exit_rate` | `countIf(is_exit = true) * 100.0 / count()` | pages | Exit page percentage |
| `goals` | `count()` | goals | Total goals triggered |
| `goal_value` | `sum(goal_value)` | goals | Total goal value |

### Available Dimensions

**Source**: `api/src/analytics/constants/dimensions.ts`

Dimensions are scoped by table. Each dimension specifies which tables it's available on.

| Category | Dimensions | Tables |
|----------|------------|--------|
| Traffic | referrer, referrer_domain, referrer_path, is_direct | sessions, goals |
| UTM | utm_source, utm_medium, utm_campaign, utm_term, utm_content | sessions, goals |
| Channel | channel, channel_group | sessions, goals |
| Session Pages | landing_page, landing_domain, landing_path, exit_path | sessions |
| Page | page_path, page_number, is_landing_page, is_exit_page, page_entry_type | pages |
| Device | device, browser, browser_type, os, screen dimensions, connection_type | sessions, goals |
| Session | duration, pageview_count | sessions |
| Time | year, month, day, day_of_week, week_number, hour, is_weekend | sessions |
| Geo | language, timezone, country, region, city, latitude, longitude | sessions, goals |
| Custom | stm_1 through stm_10 | sessions, goals |
| Goal | goal_name, goal_path | goals |

### Query Building

```typescript
interface AnalyticsQuery {
  metrics: string[];           // e.g., ['sessions', 'avg_duration']
  dimensions?: string[];       // e.g., ['utm_source', 'device']
  filters?: QueryFilter[];     // WHERE conditions
  granularity?: Granularity;   // 'hour' | 'day' | 'week' | 'month' | 'year'
  date_range: DateRange;       // { preset: 'last_7_days' } or { start, end }
  having?: QueryFilter[];      // HAVING conditions
  order_by?: OrderBy[];        // Sort configuration
  limit?: number;              // Row limit (default 10000)
  compare?: boolean;           // Include comparison period
}
```

### Generated SQL Example

```sql
-- Query: Sessions by UTM source for last 7 days, grouped by day
SELECT
  toDate(created_at, 'America/New_York') as date_day,
  utm_source,
  count() as sessions,
  round(avg(duration), 1) as avg_duration
FROM sessions
WHERE created_at >= '2024-01-08 00:00:00.000'
  AND created_at < '2024-01-15 23:59:59.999'
  AND browser_type = 'human'  -- Exclude bots
GROUP BY date_day, utm_source
HAVING sessions >= 10
ORDER BY date_day ASC, sessions DESC
LIMIT 10000
```

### Timezone Handling

Granularity grouping respects workspace timezone:

```typescript
// Workspace timezone: 'America/New_York'
// Query granularity: 'day'

// Generated SQL:
toDate(created_at, 'America/New_York') as date_day
// NOT: toDate(created_at) -- which would use UTC
```

### Gap Filling

For time-series queries, missing periods are filled:

```typescript
// Raw data: { '2024-01-01': 100, '2024-01-03': 150 }
// After gap filling: { '2024-01-01': 100, '2024-01-02': 0, '2024-01-03': 150 }
```

### Comparison Period

When `compare: true`, a second query runs for the previous period:

```
Current period: Jan 8-14
Comparison period: Jan 1-7
```

Results include both periods for trend analysis.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SDK (Web Application)                          │
│  - Generates session_id                                                     │
│  - Collects page/event data                                                 │
│  - Captures device info, UTM params                                         │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           POST /api/track                                   │
│  - Validate SessionPayloadDto                                               │
│  - Extract client IP (via @ClientIp decorator)                              │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SessionPayloadHandler.handle()                         │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Load Workspace │  │   Geo Lookup    │  │      URL Parsing            │  │
│  │  Config (1m $)  │  │  IP → Location  │  │  referrer → domain/path     │  │
│  │                 │  │  (5m cache)     │  │  landing → domain/path      │  │
│  │  - filters      │  │                 │  │                             │  │
│  │  - geo settings │  │  - country      │  └─────────────────────────────┘  │
│  │  - timezone     │  │  - region       │                                   │
│  └─────────────────┘  │  - city         │  ┌─────────────────────────────┐  │
│                       │  - coordinates  │  │    Filter Evaluation        │  │
│                       │                 │  │                             │  │
│                       │  IP NEVER STORED│  │  - Sorted by priority       │  │
│                       └─────────────────┘  │  - AND logic per filter     │  │
│                                            │  - Set channel/stm_1-10      │  │
│                                            └─────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EventBufferService                                  │
│                                                                             │
│  Per-workspace buffers                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  workspace_1: [event, event, event, ...]  (max 500)                 │   │
│  │  workspace_2: [event, event, ...]         (max 500)                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Flush triggers:                                                            │
│  - Buffer size = 500 events                                                 │
│  - Timer = 2 seconds                                                        │
│  - Server shutdown                                                          │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ClickHouse Database: staminads_ws_{id}                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         events table                                 │   │
│  │  ENGINE = MergeTree()                                               │   │
│  │  PARTITION BY toYYYYMMDD(received_at)                               │   │
│  │  ORDER BY (session_id, received_at)                                 │   │
│  │  TTL toDateTime(received_at) + INTERVAL 7 DAY                       │   │
│  │                                                                      │   │
│  │  - Raw event data                                                   │   │
│  │  - Classified dimensions (channel, stm_1-10)                         │   │
│  └─────────────────────────────────────┬───────────────────────────────┘   │
│                                        │                                    │
│                                        │ Materialized View (sessions_mv)    │
│                                        │ - any() for session-level fields   │
│                                        │ - Automatic on INSERT              │
│                                        ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        sessions table                                │   │
│  │  ENGINE = ReplacingMergeTree(updated_at)                            │   │
│  │  PARTITION BY toYYYYMM(created_at)                                  │   │
│  │  ORDER BY (created_at, id)                                          │   │
│  │                                                                      │   │
│  │  - Aggregated session data                                          │   │
│  │  - First/last event values                                          │   │
│  │  - Computed metrics (duration, max_scroll)                          │   │
│  │  - Time components for grouping                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         │                                                       │
         ▼                                                       ▼
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│     Filter Backfill             │         │     Analytics Queries           │
│                                 │         │                                 │
│  When filters change:           │         │  POST /api/analytics.query      │
│                                 │         │                                 │
│  1. Validate filters            │         │  1. Validate metrics/dimensions │
│  2. Compile to SQL              │         │  2. Resolve date range          │
│  3. Chunk by date               │         │  3. Build WHERE/HAVING          │
│  4. ALTER TABLE UPDATE          │         │  4. Execute on sessions table   │
│  5. Track progress              │         │  5. Fill gaps (if granularity)  │
│                                 │         │  6. Compare period (optional)   │
│  Respects 7-day event TTL       │         │                                 │
└─────────────────────────────────┘         └─────────────────────────────────┘
```

---

## Key Architectural Decisions Summary

| Decision | Implementation | Rationale |
|----------|---------------|-----------|
| Database per tenant | `staminads_ws_{id}` | Complete isolation, easy deletion |
| Per-workspace buffering | 500 events / 2 sec | Throughput + low latency balance |
| Materialized sessions | Auto-aggregation view | No ETL needed, always consistent |
| Real-time filtering | At ingestion time | Low query complexity |
| Lazy backfilling | On filter change only | Minimize unnecessary reprocessing |
| 7-day event TTL | Auto-expiration | Storage cost optimization |
| IP never stored | Geo lookup only | Privacy by design |
| LowCardinality strings | Country, channel, etc. | 10x compression, faster queries |
| Daily event partitions | YYYYMMDD | Fine-grained query pruning |
| Monthly session partitions | YYYYMM | Longer retention, fewer partitions |
| Task-based staleness | Filter snapshot in backfill_tasks | Simple boolean detection |
| Mutation concurrency | Semaphore (80) + hard limit (95) | Prevent ClickHouse overload, avoid TOCTOU race |

---

## Related Files

| Component | File Path |
|-----------|-----------|
| Track Controller | `api/src/events/events.controller.ts` |
| Session Payload Handler | `api/src/events/session-payload.handler.ts` |
| Event Buffer | `api/src/events/event-buffer.service.ts` |
| Session Payload DTO | `api/src/events/dto/session-payload.dto.ts` |
| Event Entity | `api/src/events/entities/event.entity.ts` |
| Geo Service | `api/src/geo/geo.service.ts` |
| Filter Entity | `api/src/filters/entities/filter.entity.ts` |
| Filter Evaluator | `api/src/filters/lib/filter-evaluator.ts` |
| Filter Compiler | `api/src/filters/lib/filter-compiler.ts` |
| Backfill Processor | `api/src/filters/backfill/backfill.processor.ts` |
| Backfill Service | `api/src/filters/backfill/backfill.service.ts` |
| Database Schemas | `api/src/database/schemas.ts` |
| ClickHouse Service | `api/src/database/clickhouse.service.ts` |
| Analytics Controller | `api/src/analytics/analytics.controller.ts` |
| Analytics Service | `api/src/analytics/analytics.service.ts` |
| Query Builder | `api/src/analytics/lib/query-builder.ts` |
| Metrics | `api/src/analytics/constants/metrics.ts` |
| Dimensions | `api/src/analytics/constants/dimensions.ts` |
