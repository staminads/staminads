# ClickHouse Session Architecture Options (Without Redis)

> **Generated:** December 2024
> **Context:** Alternatives to OpenPanel's Redis-buffered session tracking

## The Problem

OpenPanel uses Redis because:
1. Session state needs updating as events arrive
2. Batch inserts are more efficient than single-row inserts
3. Duration calculation needs previous event timestamp

But Redis adds complexity. Can we eliminate it?

---

## Option 1: Event-Only Model (No Sessions Table)

**Simplest approach** - store events, compute sessions at query time.

### Schema

```sql
CREATE TABLE events (
    id UUID DEFAULT generateUUIDv4(),
    session_id String,
    project_id String,
    created_at DateTime64(3),
    name LowCardinality(String),
    path String,
    duration UInt64,

    -- Device/Geo
    country LowCardinality(FixedString(2)),
    device LowCardinality(String),
    browser LowCardinality(String),
    os LowCardinality(String),

    -- Attribution
    referrer String,
    utm_source LowCardinality(String),
    utm_medium LowCardinality(String),
    utm_campaign LowCardinality(String),

    -- Flexible properties
    properties Map(String, String)

) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(created_at)
ORDER BY (project_id, session_id, created_at)
TTL created_at + INTERVAL 90 DAY;
```

### Query Sessions On-Demand

```sql
SELECT
    session_id,
    min(created_at) as started_at,
    max(created_at) as ended_at,
    dateDiff('second', min(created_at), max(created_at)) as duration,
    count() as event_count,
    countIf(name = 'screen_view') as page_views,
    argMin(path, created_at) as entry_path,
    argMax(path, created_at) as exit_path,
    countIf(name = 'screen_view') <= 1 as is_bounce,
    any(country) as country,
    any(device) as device,
    any(browser) as browser,
    any(referrer) as referrer
FROM events
WHERE project_id = {projectId:String}
  AND created_at >= {startDate:DateTime64}
  AND created_at <= {endDate:DateTime64}
GROUP BY session_id
ORDER BY started_at DESC
LIMIT 100;
```

### Pros & Cons

| Pros | Cons |
|------|------|
| No state management | Query-time computation |
| Simple single-table schema | Slower for session list views |
| No Redis or external dependencies | Repeated aggregation cost |
| Events are source of truth | N/A |

### When to Use

- < 10M events/day
- Session list views are infrequent
- Prefer simplicity over optimization
- ClickHouse is fast enough for most workloads

---

## Option 2: Materialized View Auto-Aggregation

Let ClickHouse aggregate sessions automatically using AggregatingMergeTree.

### Schema

```sql
-- Raw events table
CREATE TABLE events (
    id UUID DEFAULT generateUUIDv4(),
    session_id String,
    project_id String,
    created_at DateTime64(3),
    name LowCardinality(String),
    path String,
    duration UInt64,
    country LowCardinality(FixedString(2)),
    device LowCardinality(String),
    browser LowCardinality(String),
    os LowCardinality(String),
    referrer String,
    utm_source LowCardinality(String),
    properties Map(String, String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(created_at)
ORDER BY (project_id, session_id, created_at);

-- Aggregated sessions table
CREATE TABLE sessions (
    session_id String,
    project_id String,
    started_at SimpleAggregateFunction(min, DateTime64(3)),
    ended_at SimpleAggregateFunction(max, DateTime64(3)),
    event_count SimpleAggregateFunction(sum, UInt32),
    page_views SimpleAggregateFunction(sum, UInt32),
    total_duration SimpleAggregateFunction(sum, UInt64),
    entry_path AggregateFunction(argMin, String, DateTime64(3)),
    exit_path AggregateFunction(argMax, String, DateTime64(3)),
    country AggregateFunction(any, FixedString(2)),
    device AggregateFunction(any, String),
    browser AggregateFunction(any, String),
    referrer AggregateFunction(any, String)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(started_at)
ORDER BY (project_id, session_id);

-- Auto-populate on insert
CREATE MATERIALIZED VIEW sessions_mv TO sessions AS
SELECT
    session_id,
    project_id,
    minState(created_at) as started_at,
    maxState(created_at) as ended_at,
    sumState(toUInt32(1)) as event_count,
    sumState(toUInt32(name = 'screen_view')) as page_views,
    sumState(duration) as total_duration,
    argMinState(path, created_at) as entry_path,
    argMaxState(path, created_at) as exit_path,
    anyState(country) as country,
    anyState(device) as device,
    anyState(browser) as browser,
    anyState(referrer) as referrer
FROM events
GROUP BY session_id, project_id;
```

### Query Sessions

```sql
SELECT
    session_id,
    minMerge(started_at) as started_at,
    maxMerge(ended_at) as ended_at,
    dateDiff('second', minMerge(started_at), maxMerge(ended_at)) as duration,
    sumMerge(event_count) as event_count,
    sumMerge(page_views) as page_views,
    argMinMerge(entry_path) as entry_path,
    argMaxMerge(exit_path) as exit_path,
    sumMerge(page_views) <= 1 as is_bounce,
    anyMerge(country) as country,
    anyMerge(device) as device
FROM sessions
WHERE project_id = {projectId:String}
GROUP BY session_id
ORDER BY started_at DESC
LIMIT 100;
```

### Pros & Cons

| Pros | Cons |
|------|------|
| Real-time aggregation | Complex State/Merge syntax |
| No external jobs needed | Learning curve for team |
| ClickHouse-native solution | Can't easily add computed fields later |
| Incremental updates automatic | Harder to debug |

### When to Use

- Need real-time session data
- Team comfortable with ClickHouse aggregation functions
- High query volume on session lists
- Want zero maintenance after setup

---

## Option 3: Live + Archive Pattern

Two-table approach with scheduled aggregation jobs.

### Schema

```sql
-- Hot data (last 24-48 hours)
CREATE TABLE events_live (
    id UUID DEFAULT generateUUIDv4(),
    session_id String,
    project_id String,
    created_at DateTime64(3),
    name LowCardinality(String),
    path String,
    duration UInt64,
    country LowCardinality(FixedString(2)),
    device LowCardinality(String),
    browser LowCardinality(String),
    os LowCardinality(String),
    referrer String,
    utm_source LowCardinality(String),
    properties Map(String, String)
) ENGINE = MergeTree()
PARTITION BY toHour(created_at)
ORDER BY (project_id, session_id, created_at)
TTL created_at + INTERVAL 48 HOUR DELETE;

-- Long-term event storage
CREATE TABLE events (
    -- Same schema as events_live
    id UUID,
    session_id String,
    project_id String,
    created_at DateTime64(3),
    name LowCardinality(String),
    path String,
    duration UInt64,
    country LowCardinality(FixedString(2)),
    device LowCardinality(String),
    browser LowCardinality(String),
    os LowCardinality(String),
    referrer String,
    utm_source LowCardinality(String),
    properties Map(String, String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, toDate(created_at), session_id, created_at);

-- Pre-computed sessions
CREATE TABLE sessions (
    session_id String,
    project_id String,
    started_at DateTime64(3),
    ended_at DateTime64(3),
    duration UInt32,
    event_count UInt32,
    page_views UInt32,
    entry_path String,
    exit_path String,
    is_bounce Bool,
    country FixedString(2),
    device LowCardinality(String),
    browser LowCardinality(String),
    referrer String,
    utm_source LowCardinality(String),
    updated_at DateTime64(3)
) ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (project_id, session_id);
```

### Scheduled Jobs

**Job 1: Aggregate Sessions (every 5 minutes)**

```sql
INSERT INTO sessions
SELECT
    session_id,
    project_id,
    min(created_at) as started_at,
    max(created_at) as ended_at,
    dateDiff('second', min(created_at), max(created_at)) as duration,
    count() as event_count,
    countIf(name = 'screen_view') as page_views,
    argMin(path, created_at) as entry_path,
    argMax(path, created_at) as exit_path,
    countIf(name = 'screen_view') <= 1 as is_bounce,
    any(country) as country,
    any(device) as device,
    any(browser) as browser,
    any(referrer) as referrer,
    any(utm_source) as utm_source,
    now() as updated_at
FROM events_live
WHERE created_at > now() - INTERVAL 1 HOUR
GROUP BY session_id, project_id;
```

**Job 2: Archive Events (every hour)**

```sql
-- Move old events to archive
INSERT INTO events
SELECT * FROM events_live
WHERE created_at < now() - INTERVAL 2 HOUR;

-- TTL handles deletion from events_live automatically
```

### Pros & Cons

| Pros | Cons |
|------|------|
| Clear separation of concerns | Requires scheduled jobs |
| Fast queries on live data | 5-minute session delay |
| Simple, understandable schema | Two-table event management |
| Easy to modify aggregation logic | Job failure = stale data |

### When to Use

- Need pre-computed session data
- Acceptable 5-minute delay for session updates
- Want simple, debuggable architecture
- Already have job scheduling infrastructure

---

## Option 4: Recommended Hybrid Approach

**Direct insert + query-time aggregation + optional MV cache**

### Schema

```sql
-- Single events table, well-indexed
CREATE TABLE events (
    id UUID DEFAULT generateUUIDv4(),
    session_id String,
    project_id String,
    created_at DateTime64(3),

    -- Event data
    name LowCardinality(String),
    path String,
    duration UInt64 DEFAULT 0,

    -- Attribution (denormalized, set on first event of session)
    referrer String DEFAULT '',
    referrer_name LowCardinality(String) DEFAULT '',
    utm_source LowCardinality(String) DEFAULT '',
    utm_medium LowCardinality(String) DEFAULT '',
    utm_campaign LowCardinality(String) DEFAULT '',

    -- Device/Geo (set on every event, same within session)
    country LowCardinality(FixedString(2)) DEFAULT '',
    city String DEFAULT '',
    device LowCardinality(String) DEFAULT '',
    browser LowCardinality(String) DEFAULT '',
    browser_version LowCardinality(String) DEFAULT '',
    os LowCardinality(String) DEFAULT '',
    os_version LowCardinality(String) DEFAULT '',

    -- Flexible properties
    properties Map(String, String) DEFAULT map(),

    -- Indexing helpers
    INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_path path TYPE bloom_filter(0.01) GRANULARITY 1

) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(created_at)
ORDER BY (project_id, toDate(created_at), session_id, created_at)
SETTINGS index_granularity = 8192;

-- Optional: Lightweight summary MV for fast dashboard queries
CREATE MATERIALIZED VIEW sessions_daily_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date)
AS SELECT
    project_id,
    toDate(created_at) as date,
    uniq(session_id) as sessions,
    count() as events,
    countIf(name = 'screen_view') as page_views,
    sum(duration) as total_duration
FROM events
GROUP BY project_id, date;
```

### API Implementation (No Redis)

```typescript
import { ClickHouseClient } from '@clickhouse/client';

interface Event {
  session_id: string;
  project_id: string;
  created_at: Date;
  name: string;
  path: string;
  duration: number;
  // ... other fields
}

class EventBuffer {
  private batch: Event[] = [];
  private readonly maxSize: number;
  private readonly maxWaitMs: number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly clickhouse: ClickHouseClient,
    options: { maxSize?: number; maxWaitMs?: number } = {}
  ) {
    this.maxSize = options.maxSize ?? 500;
    this.maxWaitMs = options.maxWaitMs ?? 2000;
  }

  async add(event: Event): Promise<void> {
    this.batch.push(event);

    // Start timer on first event
    if (this.batch.length === 1) {
      this.flushTimer = setTimeout(() => this.flush(), this.maxWaitMs);
    }

    // Flush if batch is full
    if (this.batch.length >= this.maxSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.batch.length === 0) return;

    const events = this.batch.splice(0);

    await this.clickhouse.insert({
      table: 'events',
      values: events,
      format: 'JSONEachRow',
    });
  }

  // Call on shutdown
  async close(): Promise<void> {
    await this.flush();
  }
}

// Usage in NestJS
@Injectable()
export class EventService {
  private buffer: EventBuffer;

  constructor(private clickhouse: ClickHouseClient) {
    this.buffer = new EventBuffer(clickhouse, {
      maxSize: 500,
      maxWaitMs: 2000,
    });
  }

  async track(event: Event): Promise<void> {
    await this.buffer.add(event);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.buffer.close();
  }
}
```

### Client-Side Duration Tracking

```typescript
// SDK calculates duration between page views
class Analytics {
  private sessionId: string;
  private lastPageView: number = Date.now();
  private lastPath: string = '';

  constructor(private apiEndpoint: string) {
    this.sessionId = this.getOrCreateSessionId();
  }

  private getOrCreateSessionId(): string {
    let id = sessionStorage.getItem('session_id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('session_id', id);
    }
    return id;
  }

  trackPageView(path: string): void {
    const now = Date.now();
    const duration = this.lastPath ? now - this.lastPageView : 0;

    this.send({
      name: 'screen_view',
      path,
      duration: Math.round(duration / 1000), // seconds on previous page
      session_id: this.sessionId,
    });

    this.lastPageView = now;
    this.lastPath = path;
  }

  private send(event: object): void {
    navigator.sendBeacon(this.apiEndpoint, JSON.stringify(event));
  }
}
```

### Query Examples

**Session List:**
```sql
SELECT
    session_id,
    min(created_at) as started_at,
    max(created_at) as ended_at,
    dateDiff('second', min(created_at), max(created_at)) as duration,
    count() as event_count,
    countIf(name = 'screen_view') as page_views,
    argMin(path, created_at) as entry_path,
    argMax(path, created_at) as exit_path,
    countIf(name = 'screen_view') <= 1 as is_bounce,
    any(country) as country,
    any(device) as device,
    any(browser) as browser
FROM events
WHERE project_id = {projectId:String}
  AND created_at >= {startDate:DateTime64}
  AND created_at <= {endDate:DateTime64}
GROUP BY session_id
ORDER BY started_at DESC
LIMIT 100;
```

**Dashboard Metrics (uses MV):**
```sql
SELECT
    date,
    sum(sessions) as sessions,
    sum(page_views) as page_views,
    sum(total_duration) / sum(sessions) as avg_session_duration
FROM sessions_daily_mv
WHERE project_id = {projectId:String}
  AND date >= {startDate:Date}
  AND date <= {endDate:Date}
GROUP BY date
ORDER BY date;
```

### Pros & Cons

| Pros | Cons |
|------|------|
| Simple single-table design | Query-time aggregation for session lists |
| No Redis dependency | Requires client-side duration tracking |
| In-memory micro-batching is simple | Small delay (2s) before data visible |
| Events are source of truth | N/A |
| Optional MV for dashboards | N/A |
| Easy to understand and debug | N/A |

### When to Use

- New projects starting fresh
- Want minimal infrastructure
- TimeScore/engagement metrics focus
- Team prefers simplicity

---

## Comparison Matrix

| Aspect | Option 1 | Option 2 | Option 3 | Option 4 |
|--------|----------|----------|----------|----------|
| **Complexity** | Low | High | Medium | Low |
| **Tables** | 1 | 2 | 3 | 1-2 |
| **Real-time** | Yes | Yes | 5-min delay | Yes |
| **Query Speed** | Medium | Fast | Fast | Medium |
| **Maintenance** | None | Low | Medium | None |
| **Redis Required** | No | No | No | No |
| **Best For** | Small scale | High query volume | Pre-computed needs | Balanced approach |

---

## Recommendation for Staminads

Given the focus on **TimeScore** and **time engagement metrics**:

**Use Option 4 (Hybrid)** because:

1. **Duration is captured client-side** - accurate time tracking without server state
2. **Events are source of truth** - can always recompute sessions
3. **Simple architecture** - no Redis, no complex jobs
4. **Flexible** - add MVs later for performance if needed
5. **Matches TimeScore focus** - optimize for time metrics, not user identification

The in-memory micro-batch (2s/500 events) handles the ClickHouse "batch insert" requirement without Redis complexity.
