# OpenPanel Data Model & ClickHouse Architecture Report

> **Generated:** December 2024
> **Source:** [github.com/Openpanel-dev/openpanel](https://github.com/Openpanel-dev/openpanel)

## Executive Summary

OpenPanel is an open-source analytics platform combining Mixpanel's event-tracking capabilities with Plausible's simplicity. It uses a dual-database architecture:
- **PostgreSQL** (via Prisma ORM) for metadata, users, organizations, and configurations
- **ClickHouse** for high-volume event storage, sessions, and analytics queries

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [ClickHouse Tables](#clickhouse-tables)
3. [Events Data Model](#events-data-model)
4. [Sessions Data Model](#sessions-data-model)
5. [Profiles Data Model](#profiles-data-model)
6. [Materialized Views](#materialized-views)
7. [Data Ingestion Pipeline](#data-ingestion-pipeline)
8. [Query Patterns](#query-patterns)
9. [PostgreSQL Schema (Prisma)](#postgresql-schema-prisma)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client SDKs                               │
│         (Web, React Native, iOS, Android, Node.js)              │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Fastify Event API                             │
│              (Event validation & transformation)                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│    Redis Buffers    │   │     PostgreSQL      │
│  (Event, Session,   │   │   (Prisma ORM)      │
│   Profile, Bot)     │   │  Metadata storage   │
└─────────┬───────────┘   └─────────────────────┘
          │
          ▼ (Batch flush)
┌─────────────────────────────────────────────────────────────────┐
│                        ClickHouse                                │
│    events │ sessions │ profiles │ materialized views            │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack
- **API Layer:** Fastify, tRPC
- **Frontend:** Next.js, Tailwind, Shadcn
- **Queue:** BullMQ, GroupMQ
- **Cache:** Redis (also used for buffering)
- **Analytics DB:** ClickHouse
- **Metadata DB:** PostgreSQL

---

## ClickHouse Tables

### Table Overview

| Table Name | Engine | Purpose |
|------------|--------|---------|
| `events` | MergeTree | Primary event storage |
| `events_bots` | MergeTree | Bot/crawler event storage |
| `events_imports` | MergeTree | Imported historical events |
| `sessions` | VersionedCollapsingMergeTree | Session aggregates |
| `profiles` | ReplacingMergeTree | User profile data |
| `profile_aliases` | MergeTree | Profile ID aliasing |
| `self_hosting` | MergeTree | Self-hosting metrics |

### Table References (Constants)
```typescript
export const TABLE_NAMES = {
  events: 'events',
  profiles: 'profiles',
  alias: 'profile_aliases',
  self_hosting: 'self_hosting',
  events_bots: 'events_bots',
  dau_mv: 'dau_mv',
  event_names_mv: 'distinct_event_names_mv',
  event_property_values_mv: 'event_property_values_mv',
  cohort_events_mv: 'cohort_events_mv',
  sessions: 'sessions',
  events_imports: 'events_imports',
};
```

---

## Events Data Model

### Table Schema: `events`

```sql
CREATE TABLE events (
  -- Identifiers
  id UUID,
  name LowCardinality(String),
  project_id String,
  session_id String,
  device_id String,
  profile_id String,

  -- SDK Info
  sdk_name LowCardinality(String),
  sdk_version LowCardinality(String),

  -- Page/Screen Data
  path String,
  origin String,
  referrer String,
  referrer_name LowCardinality(String),
  referrer_type LowCardinality(String),

  -- Metrics
  duration UInt64,
  revenue Nullable(Float64),

  -- Custom Properties
  properties Map(String, String),

  -- Timestamps
  created_at DateTime64(3),
  imported_at Nullable(DateTime64(3)),

  -- Geographic Data
  country FixedString(2),
  city String,
  region String,
  longitude Nullable(Float32),
  latitude Nullable(Float32),

  -- Device/Browser Info
  os LowCardinality(String),
  os_version LowCardinality(String),
  browser LowCardinality(String),
  browser_version LowCardinality(String),
  device LowCardinality(String),
  brand LowCardinality(String),
  model LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, toDate(created_at), profile_id, name)
SETTINGS index_granularity = 8192
```

### Indexes
- **bloom_filter** on `name` - Fast event name lookups
- **set index** on `properties['__bounce']` - Bounce detection optimization
- **bloom_filter** on `origin` and `path` - URL pattern matching

### Event Types (by naming convention)
| Event Name | Description |
|------------|-------------|
| `screen_view` | Page/screen view event |
| `session_start` | Session initiation |
| `session_end` | Session termination |
| Custom events | User-defined tracking events |

### TypeScript Interface
```typescript
interface IClickhouseEvent {
  id: string;
  name: string;
  device_id: string;
  profile_id: string;
  project_id: string;
  session_id: string;
  path: string;
  origin: string;
  referrer: string;
  referrer_name: string;
  referrer_type: string;
  duration: number;
  revenue?: number;
  properties: Record<string, string>;
  created_at: string; // ClickHouse DateTime64 format
  country: string;
  city: string;
  region: string;
  longitude?: number;
  latitude?: number;
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  device: string;
  brand: string;
  model: string;
}
```

---

## Sessions Data Model

### Table Schema: `sessions`

OpenPanel uses **VersionedCollapsingMergeTree** for sessions, enabling efficient updates without traditional mutations.

```sql
CREATE TABLE sessions (
  -- Identifiers
  id String,
  project_id String CODEC(ZSTD(3)),
  profile_id String CODEC(ZSTD(3)),
  device_id String CODEC(ZSTD(3)),

  -- Timestamps
  created_at DateTime64(3) CODEC(DoubleDelta, ZSTD(3)),
  ended_at DateTime64(3) CODEC(DoubleDelta, ZSTD(3)),

  -- Session Metrics
  is_bounce Bool,
  screen_view_count Int32,
  event_count Int32,
  duration UInt32,
  revenue Float64,

  -- Geographic Data
  country FixedString(2) CODEC(LowCardinality),
  region LowCardinality(String),
  city LowCardinality(String),
  longitude Nullable(Float32) CODEC(Gorilla, LZ4),
  latitude Nullable(Float32) CODEC(Gorilla, LZ4),

  -- Device Info
  device LowCardinality(String),
  brand LowCardinality(String),
  model LowCardinality(String),
  browser LowCardinality(String),
  browser_version LowCardinality(String),
  os LowCardinality(String),
  os_version LowCardinality(String),

  -- Entry/Exit Pages
  entry_origin String,
  entry_path String,
  exit_origin String,
  exit_path String,

  -- UTM Parameters
  utm_medium String CODEC(ZSTD(3)),
  utm_source String CODEC(ZSTD(3)),
  utm_campaign String CODEC(ZSTD(3)),
  utm_content String CODEC(ZSTD(3)),
  utm_term String CODEC(ZSTD(3)),

  -- Referrer Data
  referrer String,
  referrer_name LowCardinality(String),
  referrer_type LowCardinality(String),

  -- Versioning (for CollapsingMergeTree)
  sign Int8,
  version UInt64,

  -- Custom Properties
  properties Map(String, String) CODEC(ZSTD(3))
)
ENGINE = VersionedCollapsingMergeTree(sign, version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, toStartOfHour(created_at), id)
```

### Session Lifecycle

1. **Creation:** When first event arrives with new `session_id`
2. **Updates:** Via collapsing mechanism (insert `sign=-1` to cancel, `sign=1` for new version)
3. **Metrics Updated:**
   - `ended_at` → Latest event timestamp
   - `event_count` → Incremented
   - `screen_view_count` → Incremented for screen_view events
   - `exit_path` → Updated to latest path
   - `is_bounce` → Set to false after second event

### Session Creation Rules

- Sessions **only created for client-side events** (browser, mobile, client SDK)
- Server-side events do **not** create sessions (detected by User-Agent)
- Sessions **not created for events older than 15 minutes** (prevents historical imports creating artificial sessions)
- Events with timestamps >1 minute in future use server time instead

### Session ID Generation

- **Client-side:** UUIDs generated by SDK, passed with each event
- **Server-side handling:** Reuses existing session or assigns empty string for past events
- Session IDs reusable across same device within timeout window

### Device ID Generation

Hash-based fingerprinting for anonymous tracking:
```
deviceId = hash(UserAgent + IP + Origin + DailySalt)
```
- Salt rotates **daily at midnight UTC** for privacy
- Previous day's salt maintained for events arriving after midnight
- `device_id` defaults as `profile_id` for anonymous users

### Session Timeout Rules

| Rule | Duration | Description |
|------|----------|-------------|
| **Inactivity timeout** | 30 minutes | Session ends if no events received |
| **Redis TTL** | 1 hour | Session state expires from Redis cache |
| **Explicit end** | Immediate | `session_end` event from client |

### Session-Event Relationship

- Sessions are **reconstructed from events** by grouping on `session_id`
- Each event contains `session_id` linking it to a session
- Session data is **denormalized** for query performance

### Screen View Duration Tracking

Uses **Redis Lua scripts** for atomic duration calculation:
1. Store last screen_view in Redis: `event_buffer:last_screen_view:session:{sessionId}`
2. On next screen_view, calculate duration from previous
3. Atomic operations prevent race conditions

### Retention Window
- **Standard:** 360-day lookback
- **High-volume (>1M events):** 1-day lookback (performance optimization)

---

## Profiles Data Model

### Table Schema: `profiles`

```sql
CREATE TABLE profiles (
  id String,
  project_id String,
  is_external Bool,
  first_name String,
  last_name String,
  email String,
  avatar String,
  properties Map(String, String),
  created_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, id)
```

### Profile Aliasing

```sql
CREATE TABLE profile_aliases (
  project_id String,
  profile_id String,
  alias String,
  created_at DateTime
)
ENGINE = MergeTree
ORDER BY (project_id, profile_id, alias, created_at)
```

### Indexes
- **bloom_filter** on `first_name`, `last_name`, `email`

---

## Materialized Views

### 1. Daily Active Users (DAU)

**Table:** `dau_mv`

Aggregates daily unique profiles per project for fast DAU queries.

### 2. Cohort Events

**Table:** `cohort_events_mv`

Groups events by project, event name, date, and profile for cohort analysis.

### 3. Distinct Event Names

**Table:** `distinct_event_names_mv`

Maintains count of distinct event names per project (for autocomplete/filters).

### 4. Event Property Values

**Table:** `event_property_values_mv`

Extracts and aggregates event property key-value pairs for property-based filtering.

---

## Data Ingestion Pipeline

### Buffer Architecture

```
Event Arrival → Validation → Buffer Add → Batch Flush → ClickHouse Insert
```

### Buffer Types

| Buffer | Purpose | Batch Size | Cache TTL |
|--------|---------|------------|-----------|
| `event-buffer` | Events queue | 1000 | - |
| `session-buffer` | Session updates | 1000 | 1 hour |
| `profile-buffer` | Profile upserts | 1000 | - |
| `bot-buffer` | Bot events | 1000 | - |

### Session Buffer Flow

1. **Event arrives** with `session_id`
2. **Lookup session** in Redis (`session:{id}` or `session:{projectId}:{profileId}`)
3. **If exists:** Clone, update metrics, increment version
4. **If new:** Initialize from event data
5. **Write both versions** to buffer:
   - `sign: -1` (deletion marker for old version)
   - `sign: 1` (insertion for new version)
6. **On batch threshold:** Flush to ClickHouse via JSONEachRow format

### Event Transformation

```typescript
function createEvent(payload: EventPayload): IClickhouseEvent {
  return {
    id: generateUUID(),
    name: payload.name,
    // ... flatten properties via toDots()
    created_at: formatToClickHouseDateTime(new Date()),
    // ... transform geographic and device data
  };
}
```

---

## Query Patterns

### Time-Series Aggregation

```sql
SELECT
  toStartOfDay(created_at, 'UTC') as date,
  count(*) as count
FROM events
WHERE project_id = {projectId}
  AND created_at >= {startDate}
  AND created_at <= {endDate}
GROUP BY date
ORDER BY date
```

### Segmentation by Property

```sql
SELECT
  countDistinct(profile_id) as count,
  properties['country'] as country
FROM events
WHERE project_id = {projectId}
  AND name = 'screen_view'
GROUP BY country
ORDER BY count DESC
LIMIT 10
```

### Funnel Analysis

Uses ClickHouse's `windowFunnel()` function:

```sql
SELECT
  profile_id,
  windowFunnel(86400)(
    created_at,
    name = 'step1',
    name = 'step2',
    name = 'step3'
  ) as level
FROM events
WHERE project_id = {projectId}
GROUP BY profile_id
```

### Retention Analysis

Weekly cohort retention using self-join:

```sql
WITH first_week AS (
  SELECT profile_id, toStartOfWeek(min(created_at)) as cohort_week
  FROM events
  WHERE project_id = {projectId}
  GROUP BY profile_id
)
SELECT
  cohort_week,
  count(DISTINCT profile_id) as users,
  countIf(last_seen >= cohort_week + INTERVAL 1 WEEK) as retained_week_1
FROM first_week
LEFT JOIN (
  SELECT profile_id, max(created_at) as last_seen
  FROM events
  GROUP BY profile_id
) USING profile_id
GROUP BY cohort_week
```

### Session Queries

Always use `FINAL` modifier for correct collapsed results:

```sql
SELECT *
FROM sessions FINAL
WHERE project_id = {projectId}
  AND created_at > now() - INTERVAL 7 DAY
ORDER BY created_at DESC
LIMIT 100
```

### Profile Joins

```sql
SELECT e.*, p.email, p.first_name
FROM events e
LEFT ANY JOIN profiles p ON p.id = e.profile_id AND p.project_id = e.project_id
WHERE e.project_id = {projectId}
```

---

## PostgreSQL Schema (Prisma)

### Core Entities

```prisma
enum ProjectType {
  website
  app
  backend
}

model Organization {
  id        String    @id @default(cuid())
  name      String
  timezone  String    @default("UTC")
  members   Member[]
  projects  Project[]
  // ...
}

model Project {
  id             String      @id @default(cuid())
  name           String
  type           ProjectType @default(website)
  organizationId String
  domain         String?
  cors           String[]
  // Event count tracking
  eventsCount    Int         @default(0)
  // ...
}

model Dashboard {
  id        String   @id @default(cuid())
  name      String
  projectId String
  reports   Report[]
}

model Report {
  id          String    @id @default(cuid())
  name        String
  chartType   ChartType
  events      Json      // IChartEventItem[]
  breakdowns  Json      // Breakdown configuration
  dashboardId String
}
```

### Key Enums

```prisma
enum ChartType {
  linear
  bar
  histogram
  pie
  metric
  area
  map
  funnel
  retention
  conversion
}

enum Interval {
  minute
  hour
  day
  week
  month
}

enum Metric {
  sum
  average
  min
  max
}
```

### Analytics Features

| Feature | Implementation |
|---------|---------------|
| **Funnels** | windowFunnel() with configurable time window (default 24h) |
| **Retention** | Weekly cohort analysis with self-joins |
| **DAU/MAU** | Materialized view aggregation |
| **Property Analytics** | Map column with bloom filter indexes |
| **Geographic** | FixedString(2) country codes, city/region strings |

---

## Performance Optimizations

### Column Compression
- **ZSTD(3)** for high-entropy string columns (project_id, UTM params)
- **DoubleDelta** for timestamps
- **Gorilla + LZ4** for floating-point geo coordinates
- **LowCardinality** for enum-like strings (device, browser, OS)

### Partitioning Strategy
- Monthly partitions by `toYYYYMM(created_at)`
- Enables efficient date-range queries and TTL management

### Index Strategy
- **bloom_filter** for string pattern matching
- **set index** for low-cardinality property values
- Primary key optimized for common access patterns

### Query Optimizations
- Selective field retrieval to minimize data transfer
- Subqueries for breakdown calculations
- Caching layer with 5-10 minute TTLs
- Dynamic interval expansion when results are sparse

---

## ClickHouse Client Configuration

### Connection Settings

```typescript
const clickhouseClient = {
  max_open_connections: 30,
  request_timeout: 300000, // 5 minutes
  keep_alive: {
    enabled: true,
    idle_socket_ttl: 60000
  },
  compression: {
    request: true
  }
};
```

### Query Settings

```typescript
// Disable automatic join optimization that can break queries
query_plan_convert_any_join_to_semi_or_anti_join: 0
```

### Retry Mechanism

- Proxy wrapper applies `withRetry` to inserts and commands
- Exponential backoff up to 3 attempts
- Handles connection errors gracefully

---

## Advanced Query Patterns

### Query Builder Architecture

OpenPanel uses a **fluent query builder pattern**:

```typescript
const { sb, getSql, join } = createSqlBuilder();
sb.select = { count: 'count(*)' };
sb.where = { project: `project_id = ${escape(projectId)}` };
sb.groupBy = { date: 'toStartOfDay(created_at)' };
const query = getSql();
```

### CTE Pattern for High Cardinality Breakdowns

Pre-calculate top N values to limit cardinality explosion:

```sql
WITH top_values AS (
  SELECT field, count(*) as cnt
  FROM events
  WHERE project_id = {projectId}
  GROUP BY field
  ORDER BY cnt DESC
  LIMIT 10
)
SELECT
  e.field,
  count(*) as count
FROM events e
WHERE e.project_id = {projectId}
  AND e.field IN (SELECT field FROM top_values)
GROUP BY e.field
```

### Time Bucketing Functions

| Function | Usage |
|----------|-------|
| `toStartOfMinute(created_at)` | Minute granularity |
| `toStartOfHour(created_at)` | Hour granularity |
| `toStartOfDay(created_at, 'timezone')` | Day (TZ-aware) |
| `toStartOfWeek(created_at, 1, 'timezone')` | Week (Monday start) |
| `toStartOfMonth(created_at)` | Month granularity |

### Fill Strategy for Time Gaps

```sql
SELECT date, count
FROM events
WHERE ...
ORDER BY date WITH FILL
  FROM toStartOfDay({startDate})
  TO toStartOfDay({endDate})
  STEP INTERVAL 1 DAY
```

### Insights with Window Functions

```sql
-- Rolling 7-day average
SELECT
  date,
  count,
  avg(count) OVER (
    ORDER BY date
    ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING
  ) as rolling_avg
FROM daily_counts

-- Period-over-period comparison
SELECT
  month,
  users,
  lag(users) OVER (ORDER BY month) as prev_month_users
FROM monthly_users
```

### Cursor-Based Pagination

Instead of OFFSET (which scans all rows):

```sql
SELECT *
FROM events
WHERE project_id = {projectId}
  AND created_at <= {cursor}
  AND created_at >= toDateTime64({cursor}) - INTERVAL 30 DAY
ORDER BY created_at DESC
LIMIT 50
```

### Conditional Joins (Performance)

Only join when needed:

```typescript
// Only join profile table if profile fields are requested
if (needsProfileFields) {
  sb.join = `LEFT ANY JOIN profiles p ON p.id = e.profile_id`;
  sb.select.email = 'p.email';
}
```

---

## Key Takeaways for Staminads

1. **Event-centric model:** All data flows from events; sessions are derived
2. **Collapsing for updates:** Use VersionedCollapsingMergeTree for mutable aggregates
3. **Buffer pattern:** Redis queues with batch flushing to ClickHouse
4. **Denormalization:** Session data repeated in events for query performance
5. **Property maps:** Flexible schema via `Map(String, String)` columns
6. **Compression matters:** Significant storage savings with codec selection
7. **Materialized views:** Pre-aggregate common queries (DAU, property values)
8. **Query builder pattern:** Use fluent builders instead of raw SQL strings
9. **CTE for cardinality:** Pre-calculate top N values before main query
10. **Cursor pagination:** Use timestamp-based cursors, not OFFSET
11. **Conditional joins:** Only join tables when their fields are needed
12. **Batch inserts:** Queue thousands of rows before flushing to ClickHouse
13. **Bloom filters:** Essential for high-cardinality text columns
14. **Cache aggressively:** 5-minute Redis cache for expensive aggregations
