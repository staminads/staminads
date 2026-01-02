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
| `/api/track` | POST | Single event tracking |
| `/api/track.batch` | POST | Batch event tracking (multiple events) |

**Source**: `api/src/events/events.controller.ts`

### Event Data Model

The SDK sends events conforming to `TrackEventDto`:

```typescript
interface TrackEventDto {
  // Identifiers
  workspace_id: string;      // Workspace identifier
  session_id: string;        // Client-generated session ID

  // Event metadata
  name: string;              // Event name (e.g., "pageview", "click")
  path: string;              // Current page path
  duration?: number;         // Time spent on previous page (ms)

  // Traffic source
  referrer?: string;         // Full referrer URL
  referrer_domain?: string;  // Referrer domain (can be derived)
  is_direct?: boolean;       // Direct traffic flag

  // UTM parameters
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;

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

  // Engagement
  max_scroll?: number;       // Maximum scroll depth (0-100%)

  // Extensibility
  properties?: Map<string, string>;  // Custom properties
}
```

**Source**: `api/src/events/dto/track-event.dto.ts`

### Client IP Handling

The client IP is extracted via the `@ClientIp()` decorator but is **never stored**. It is used exclusively for geo-location lookup, after which only the geo results are persisted.

---

## Data Transformations

### Processing Pipeline

When an event is received, it undergoes the following transformations in `EventsService.buildEvent()`:

**Source**: `api/src/events/events.service.ts`

#### 1. Workspace Configuration Loading

```typescript
// Workspace config is cached for 1 minute
const workspace = await this.workspacesService.findOne(workspaceId);
// Config includes: filters, geo_settings, custom_dimensions, timezone
```

- Workspace settings are cached in-memory for 1 minute
- Cache is invalidated when workspace is updated or filters change

#### 2. Geo-Location Lookup

**Source**: `api/src/geo/geo.service.ts`

The geo service uses MaxMind GeoLite2 database:

```typescript
// IP → Geo lookup (results cached 5 min, max 10,000 entries)
const geo = await this.geoService.lookup(clientIp);

// Geo result structure
interface GeoResult {
  country?: string;    // ISO country code
  region?: string;     // State/province
  city?: string;       // City name
  latitude?: number;   // Coordinates (precision configurable)
  longitude?: number;
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
interface Filter {
  name: string;
  priority: number;           // Higher priority evaluated first
  conditions: FilterCondition[];  // AND logic
  operations: FilterOperation[];
}

interface FilterCondition {
  field: string;              // e.g., "utm_source", "referrer_domain"
  operator: string;           // "equals", "contains", "matches", etc.
  values: string[];           // Values to match
  case_sensitive: boolean;
}

interface FilterOperation {
  type: 'set_value' | 'unset_value' | 'set_default_value';
  dimension: string;          // "channel", "cd_1"-"cd_10"
  value?: string;             // Value to set
}
```

**Operation semantics**:
- `set_value`: Always set the dimension (higher priority filter wins)
- `unset_value`: Clear the dimension value
- `set_default_value`: Set only if dimension is currently null/empty

**Affected dimensions**: `channel`, `channel_group`, `cd_1`-`cd_10`, UTM parameters, `referrer_domain`, `is_direct`

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

**Source**: `api/src/database/schemas.ts:54-127`

```sql
CREATE TABLE events (
  -- Identifiers
  id UUID DEFAULT generateUUIDv4(),
  session_id String,
  workspace_id String,
  created_at DateTime64(3),       -- Millisecond precision

  -- Event metadata
  name LowCardinality(String),
  path String,
  duration UInt64,

  -- Traffic source
  referrer String,
  referrer_domain String,
  referrer_path String,
  is_direct Bool,

  -- Landing page
  landing_page String,
  landing_domain String,
  landing_path String,

  -- UTM parameters (all String type)
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  utm_id String,
  utm_id_from String,

  -- Channel classification
  channel LowCardinality(String),
  channel_group LowCardinality(String),

  -- Custom dimensions
  cd_1 String, cd_2 String, ..., cd_10 String,

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

  -- SDK version
  sdk_version String,

  -- Extensibility
  properties Map(String, String),

  -- Indexes
  INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(created_at)
ORDER BY (session_id, created_at)
TTL created_at + INTERVAL 7 DAY
```

### Sessions Table Schema

**Source**: `api/src/database/schemas.ts:129-206`

```sql
CREATE TABLE sessions (
  -- Identifiers
  id String,                      -- Same as session_id
  workspace_id String,
  created_at DateTime64(3),       -- First event timestamp
  updated_at DateTime64(3),       -- Last event timestamp

  -- Computed metrics
  duration UInt64,                -- Session duration (seconds)

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
  entry_page String,              -- First page viewed
  exit_page String,               -- Last page viewed

  -- UTM (from first event)
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  utm_id String,
  utm_id_from String,

  -- Channels (from first event)
  channel LowCardinality(String),
  channel_group LowCardinality(String),

  -- Custom dimensions (from first event)
  cd_1 String, ..., cd_10 String,

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

  -- Engagement (max across session)
  max_scroll UInt8,

  sdk_version String
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, id)
```

---

## Database Optimization Strategies

### 1. Table Engine Selection

| Table | Engine | Rationale |
|-------|--------|-----------|
| `events` | MergeTree | Append-heavy workload, no updates needed |
| `sessions` | ReplacingMergeTree | Updates via materialized view aggregation |
| `workspaces` | ReplacingMergeTree | Config updates via INSERT pattern |
| `backfill_tasks` | ReplacingMergeTree | Status updates during processing |

**ReplacingMergeTree** handles updates by:
1. Inserting new rows with updated values
2. Background merging keeps latest version (by `updated_at`)
3. Query time: `FINAL` modifier ensures deduplication

### 2. Partitioning Strategy

| Table | Partition Key | Partition Size | Rationale |
|-------|---------------|----------------|-----------|
| `events` | `toYYYYMMDD(created_at)` | Daily | Fine-grained pruning for recent data queries |
| `sessions` | `toYYYYMM(created_at)` | Monthly | Coarser for longer retention, fewer partitions |

**Benefits**:
- **Query optimization**: ClickHouse skips irrelevant partitions
- **Backfill efficiency**: Process one partition at a time
- **Maintenance**: Easy partition dropping for data retention

### 3. Primary Key (ORDER BY) Design

**Events table**: `ORDER BY (session_id, created_at)`

```sql
-- Optimized queries:
-- 1. Get all events for a session
SELECT * FROM events WHERE session_id = 'abc123' ORDER BY created_at;

-- 2. Get events in time range within a session
SELECT * FROM events
WHERE session_id = 'abc123'
  AND created_at BETWEEN '2024-01-01' AND '2024-01-02';
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
TTL created_at + INTERVAL 7 DAY
```

**Rationale**:
- Raw events are only needed for recent analysis
- Sessions table retains aggregated data longer
- Reduces storage costs significantly
- Backfill processor respects TTL boundary

---

## Materialized Views & Aggregations

### Sessions Materialized View

**Source**: `api/src/database/schemas.ts` (sessions_mv creation)

```sql
CREATE MATERIALIZED VIEW sessions_mv TO sessions AS
SELECT
  session_id as id,
  workspace_id,

  -- Timestamps
  min(created_at) as created_at,
  max(created_at) as updated_at,
  dateDiff('second', min(created_at), max(created_at)) as duration,

  -- Time components (from first event)
  argMin(toYear(created_at), created_at) as year,
  argMin(toMonth(created_at), created_at) as month,
  argMin(toDayOfMonth(created_at), created_at) as day,
  argMin(toDayOfWeek(created_at), created_at) as day_of_week,
  argMin(toWeek(created_at), created_at) as week_number,
  argMin(toHour(created_at), created_at) as hour,
  argMin(toDayOfWeek(created_at) IN (6, 7), created_at) as is_weekend,

  -- First event values (argMin = value where created_at is minimum)
  argMin(referrer, created_at) as referrer,
  argMin(referrer_domain, created_at) as referrer_domain,
  argMin(referrer_path, created_at) as referrer_path,
  argMin(is_direct, created_at) as is_direct,
  argMin(landing_page, created_at) as landing_page,
  argMin(landing_domain, created_at) as landing_domain,
  argMin(landing_path, created_at) as landing_path,
  argMin(path, created_at) as entry_page,

  -- Last event values (argMax = value where created_at is maximum)
  argMax(path, created_at) as exit_page,

  -- UTM from first event
  argMin(utm_source, created_at) as utm_source,
  argMin(utm_medium, created_at) as utm_medium,
  argMin(utm_campaign, created_at) as utm_campaign,
  argMin(utm_term, created_at) as utm_term,
  argMin(utm_content, created_at) as utm_content,
  argMin(utm_id, created_at) as utm_id,
  argMin(utm_id_from, created_at) as utm_id_from,

  -- Channels from first event
  argMin(channel, created_at) as channel,
  argMin(channel_group, created_at) as channel_group,

  -- Custom dimensions from first event
  argMin(cd_1, created_at) as cd_1,
  -- ... cd_2 through cd_10 ...

  -- Device info (any value - assumed constant per session)
  any(screen_width) as screen_width,
  any(screen_height) as screen_height,
  any(viewport_width) as viewport_width,
  any(viewport_height) as viewport_height,
  any(user_agent) as user_agent,
  any(language) as language,
  any(timezone) as timezone,
  any(country) as country,
  any(region) as region,
  any(city) as city,
  any(latitude) as latitude,
  any(longitude) as longitude,
  any(browser) as browser,
  any(browser_type) as browser_type,
  any(os) as os,
  any(device) as device,
  any(connection_type) as connection_type,

  -- Engagement (max across all events)
  max(max_scroll) as max_scroll,

  any(sdk_version) as sdk_version

FROM events
GROUP BY session_id, workspace_id
```

### Aggregation Functions Explained

| Function | Usage | Behavior |
|----------|-------|----------|
| `min(created_at)` | Session start | Earliest timestamp |
| `max(created_at)` | Session end | Latest timestamp |
| `argMin(field, created_at)` | First event value | Value where created_at is minimum |
| `argMax(field, created_at)` | Last event value | Value where created_at is maximum |
| `any(field)` | Stable value | Any value (assumes consistency) |
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
interface Filter {
  name: string;
  priority: number;              // 1-1000, higher = evaluated first
  conditions: FilterCondition[];
  operations: FilterOperation[];
}

interface FilterCondition {
  field: string;                 // Source field to check
  operator: FilterOperator;      // Comparison type
  values: string[];              // Values to match
  case_sensitive: boolean;
}

type FilterOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'matches' | 'not_matches'    // Regex (RE2 syntax)
  | 'is_empty' | 'is_not_empty'
  | 'is_null' | 'is_not_null';

interface FilterOperation {
  type: 'set_value' | 'unset_value' | 'set_default_value';
  dimension: string;             // Target dimension
  value?: string;                // Value to set (if applicable)
}
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
  cd_1 = CASE
    WHEN (path LIKE '/products/%') THEN 'Product Page'
    ELSE cd_1
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

| Metric | SQL Expression | Description |
|--------|----------------|-------------|
| `sessions` | `count()` | Number of sessions |
| `avg_duration` | `round(avg(duration), 1)` | Average session duration |
| `median_duration` | `round(median(duration), 1)` | Median session duration |
| `max_scroll` | `round(avg(max_scroll), 1)` | Average max scroll depth |
| `bounce_rate` | `round(countIf(duration < 10) * 100.0 / count(), 2)` | Bounce rate percentage |

### Available Dimensions

**Source**: `api/src/analytics/constants/dimensions.ts`

| Category | Dimensions |
|----------|------------|
| Traffic | referrer, referrer_domain, referrer_path, is_direct |
| UTM | utm_source, utm_medium, utm_campaign, utm_term, utm_content |
| Channel | channel, channel_group |
| Pages | landing_page, landing_domain, landing_path, entry_page, exit_page |
| Device | device, browser, browser_type, os, screen dimensions, connection_type |
| Time | year, month, day, day_of_week, week_number, hour, is_weekend |
| Geo | language, timezone, country, region, city |
| Custom | cd_1 through cd_10 |

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
│                    POST /api/track or /api/track.batch                      │
│  - Validate TrackEventDto                                                   │
│  - Extract client IP (via @ClientIp decorator)                              │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EventsService.buildEvent()                          │
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
│                                            │  - Set channel/cd_1-10      │  │
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
│  │  PARTITION BY toYYYYMMDD(created_at)                                │   │
│  │  ORDER BY (session_id, created_at)                                  │   │
│  │  TTL created_at + INTERVAL 7 DAY                                    │   │
│  │                                                                      │   │
│  │  - Raw event data                                                   │   │
│  │  - Classified dimensions (channel, cd_1-10)                         │   │
│  └─────────────────────────────────────┬───────────────────────────────┘   │
│                                        │                                    │
│                                        │ Materialized View (sessions_mv)    │
│                                        │ - argMin/argMax aggregation        │
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
| Events Service | `api/src/events/events.service.ts` |
| Event Buffer | `api/src/events/event-buffer.service.ts` |
| Event DTO | `api/src/events/dto/track-event.dto.ts` |
| Geo Service | `api/src/geo/geo.service.ts` |
| Filter Evaluator | `api/src/filters/lib/filter-evaluator.ts` |
| Filter Compiler | `api/src/filters/lib/filter-compiler.ts` |
| Backfill Processor | `api/src/filters/backfill/backfill.processor.ts` |
| Database Schemas | `api/src/database/schemas.ts` |
| ClickHouse Service | `api/src/database/clickhouse.service.ts` |
| Analytics Controller | `api/src/analytics/analytics.controller.ts` |
| Analytics Service | `api/src/analytics/analytics.service.ts` |
| Query Builder | `api/src/analytics/lib/query-builder.ts` |
| Metrics | `api/src/analytics/constants/metrics.ts` |
| Dimensions | `api/src/analytics/constants/dimensions.ts` |
