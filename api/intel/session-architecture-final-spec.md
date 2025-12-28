# Staminads Session Architecture Specification

> **Status:** Final
> **Date:** December 2024
> **Context:** ClickHouse schema design for TimeScore analytics

---

## 1. Requirements

| Requirement | Description |
|-------------|-------------|
| **Live Dashboard** | Data visible within seconds of event arrival |
| **Median Duration** | Primary metric is median session duration (non-additive) |
| **Dynamic Dimensions** | Users can slice by any combination of dimensions at query time |

---

## 2. Why Sessions Table is Mandatory

### The Math Problem

Median is **non-additive**:
```
median([1,2,3]) = 2
median([4,5,6]) = 5
median([1,2,3,4,5,6]) = 3.5 ≠ (2+5)/2
```

You cannot pre-aggregate medians. You need access to individual session durations.

### The Performance Problem

Without a sessions table:
```
Query: "Median duration by country + device"

Step 1: Scan 10M events
Step 2: GROUP BY session_id → 500K sessions (calculate duration)
Step 3: GROUP BY country, device → median per group

Execution: 2-5 seconds (too slow for live dashboard)
```

With a sessions table:
```
Query: "Median duration by country + device"

Step 1: Scan 500K session rows (duration pre-calculated)
Step 2: GROUP BY country, device → median per group

Execution: 100-300ms (dashboard-acceptable)
```

### The Dynamic Dimension Problem

If dimensions were fixed (always `utm_source`), we could pre-aggregate:
```sql
-- Pre-aggregated cube (doesn't work for dynamic dims)
CREATE TABLE sessions_by_source (
    utm_source String,
    date Date,
    duration_quantile AggregateFunction(quantileTDigest, UInt32)
)
```

But users want to query by **any** combination:
- `utm_source` alone
- `utm_source + country`
- `country + device + browser`
- `entry_path + referrer_domain`

Pre-aggregating all combinations = combinatorial explosion. Impractical.

**Solution:** One row per session with ALL dimensions denormalized. Let ClickHouse GROUP BY at query time—it's fast enough on session-level data.

---

## 3. Architecture Decision

### Chosen Approach: Sessions Table with Materialized View

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   SDK/API   │────▶│   events    │────▶│  sessions   │
└─────────────┘     └─────────────┘     └─────────────┘
                          │                    │
                          │ (MV triggers)      │
                          └────────────────────┘

                    Query: sessions table (fast)
```

### Why Not Alternatives?

| Alternative | Rejected Because |
|-------------|------------------|
| Events-only (Option 1) | Double aggregation too slow for median at scale |
| AggregatingMergeTree | Still requires GROUP BY session_id; more complex syntax |
| Batch job only | 60-second minimum latency; not "live" enough |
| Pre-aggregated cubes | Can't support dynamic dimension combinations |

### Why ReplacingMergeTree?

- **Simple mental model:** One row per session, latest wins
- **FINAL keyword:** Collapses duplicates at query time
- **No State/Merge syntax:** Cleaner than AggregatingMergeTree
- **Handles updates naturally:** Session metrics update as events arrive

---

## 4. Schema Definition

### 4.1 Events Table (Source of Truth)

```sql
CREATE TABLE events (
    -- Identifiers
    id UUID DEFAULT generateUUIDv4(),
    session_id String,
    workspace_id String,

    -- Timestamps
    created_at DateTime64(3),

    -- Event data
    name LowCardinality(String),  -- 'screen_view', 'scroll', 'click', custom events
    path String,
    duration UInt64 DEFAULT 0,    -- Time on previous page (client-calculated)

    -- Traffic source
    referrer Nullable(String),
    referrer_domain Nullable(String),
    referrer_path Nullable(String),
    is_direct Bool DEFAULT false,

    -- Landing page
    landing_page String,
    landing_domain Nullable(String),
    landing_path Nullable(String),

    -- UTM parameters
    utm_source Nullable(String),
    utm_medium Nullable(String),
    utm_campaign Nullable(String),
    utm_term Nullable(String),
    utm_content Nullable(String),
    utm_id Nullable(String),
    utm_id_from Nullable(String),

    -- Channel attribution
    channel Nullable(String),  -- derived: organic, paid, social, direct, etc.

    -- Screen/Viewport
    screen_width Nullable(UInt16),
    screen_height Nullable(UInt16),
    viewport_width Nullable(UInt16),
    viewport_height Nullable(UInt16),

    -- Device (from UA parser)
    device Nullable(String),        -- mobile, tablet, desktop
    browser Nullable(String),       -- Chrome, Safari, Firefox
    browser_type Nullable(String),  -- crawler, inapp, email, or null
    os Nullable(String),            -- iOS, Android, Windows, macOS
    user_agent Nullable(String),
    connection_type Nullable(String), -- 4g, 3g, 2g, slow-2g, wifi

    -- Browser APIs
    language Nullable(String),      -- en-US, fr-FR, etc.
    timezone Nullable(String),      -- America/New_York, etc.

    -- Engagement
    max_scroll Nullable(UInt8),     -- 0-100 percentage
    sdk_version Nullable(String),

    -- Flexible properties
    properties Map(String, String) DEFAULT map(),

    -- Indexes
    INDEX idx_workspace_id workspace_id TYPE bloom_filter GRANULARITY 1,
    INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1

) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(created_at)
ORDER BY (workspace_id, session_id, created_at)
TTL created_at + INTERVAL 7 DAY;  -- 7 days for reprocessing capability
```

**Design decisions:**

| Decision | Rationale |
|----------|-----------|
| `Nullable` for optional fields | Matches existing schema; explicit null handling |
| `UInt16` for screen/viewport | Max 65535px, sufficient for any display |
| `UInt8` for max_scroll | 0-100 percentage fits in 1 byte |
| `browser_type` index | Fast filtering of bots/crawlers |
| 7-day TTL | Balance between storage and reprocessing capability |
| ORDER BY includes `session_id` | Fast session reconstruction |

### 4.2 Sessions Table (Query Target)

Matches existing `web_sessions` schema with added MV support columns.

```sql
CREATE TABLE sessions (
    -- Identifiers
    id String,  -- session_id
    workspace_id String,

    -- Timestamps
    created_at DateTime64(3),   -- session start
    updated_at DateTime64(3),   -- last event time (ReplacingMergeTree version)
    duration Nullable(UInt32),  -- seconds, pre-calculated

    -- Time dimensions (for fast aggregations without date functions)
    year UInt16,
    month UInt8,
    day UInt8,
    day_of_week UInt8,
    week_number UInt8,
    hour UInt8,
    is_weekend Bool,

    -- Traffic source
    referrer Nullable(String),
    referrer_domain Nullable(String),
    referrer_path Nullable(String),
    is_direct Bool,

    -- Landing page
    landing_page String,
    landing_domain Nullable(String),
    landing_path Nullable(String),
    entry_page Nullable(String),
    exit_page Nullable(String),

    -- UTM parameters
    utm_source Nullable(String),
    utm_medium Nullable(String),
    utm_campaign Nullable(String),
    utm_term Nullable(String),
    utm_content Nullable(String),
    utm_id Nullable(String),
    utm_id_from Nullable(String),

    -- Channel attribution
    channel Nullable(String),

    -- Screen/Viewport
    screen_width Nullable(UInt16),
    screen_height Nullable(UInt16),
    viewport_width Nullable(UInt16),
    viewport_height Nullable(UInt16),

    -- Device
    user_agent Nullable(String),
    language Nullable(String),
    timezone Nullable(String),
    browser Nullable(String),
    browser_type Nullable(String),
    os Nullable(String),
    device Nullable(String),
    connection_type Nullable(String),

    -- Engagement
    max_scroll Nullable(UInt8),
    sdk_version Nullable(String),

    -- Indexes
    INDEX idx_workspace_id workspace_id TYPE bloom_filter GRANULARITY 1,
    INDEX idx_created_at created_at TYPE minmax GRANULARITY 1

) ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at, id);
```

**Design decisions:**

| Decision | Rationale |
|----------|-----------|
| Time dimensions stored | Fast GROUP BY without `toYear()`, `toMonth()` functions |
| `duration Nullable(UInt32)` | Pre-calculated seconds; null for ongoing sessions |
| Partition by month | Balances partition count with pruning efficiency |
| ORDER BY `created_at` before `id` | Efficient time-range scans |

### 4.3 Materialized View (Real-Time Sync)

```sql
CREATE MATERIALIZED VIEW sessions_mv TO sessions AS
SELECT
    session_id as id,
    workspace_id,

    -- Timestamps
    min(events.created_at) as created_at,
    max(events.created_at) as updated_at,
    dateDiff('second', min(events.created_at), max(events.created_at)) as duration,

    -- Time dimensions (from session start, using argMin to avoid nested aggregates)
    argMin(toYear(events.created_at), events.created_at) as year,
    argMin(toMonth(events.created_at), events.created_at) as month,
    argMin(toDayOfMonth(events.created_at), events.created_at) as day,
    argMin(toDayOfWeek(events.created_at), events.created_at) as day_of_week,
    argMin(toWeek(events.created_at), events.created_at) as week_number,
    argMin(toHour(events.created_at), events.created_at) as hour,
    argMin(toDayOfWeek(events.created_at) IN (6, 7), events.created_at) as is_weekend,

    -- Traffic source (first-touch)
    argMin(referrer, events.created_at) as referrer,
    argMin(referrer_domain, events.created_at) as referrer_domain,
    argMin(referrer_path, events.created_at) as referrer_path,
    argMin(is_direct, events.created_at) as is_direct,

    -- Landing page (first event)
    argMin(landing_page, events.created_at) as landing_page,
    argMin(landing_domain, events.created_at) as landing_domain,
    argMin(landing_path, events.created_at) as landing_path,
    argMin(path, events.created_at) as entry_page,
    argMax(path, events.created_at) as exit_page,

    -- UTM parameters (first-touch)
    argMin(utm_source, events.created_at) as utm_source,
    argMin(utm_medium, events.created_at) as utm_medium,
    argMin(utm_campaign, events.created_at) as utm_campaign,
    argMin(utm_term, events.created_at) as utm_term,
    argMin(utm_content, events.created_at) as utm_content,
    argMin(utm_id, events.created_at) as utm_id,
    argMin(utm_id_from, events.created_at) as utm_id_from,

    -- Channel (first-touch)
    argMin(channel, events.created_at) as channel,

    -- Screen/Viewport (stable within session)
    any(screen_width) as screen_width,
    any(screen_height) as screen_height,
    any(viewport_width) as viewport_width,
    any(viewport_height) as viewport_height,

    -- Device (stable within session)
    any(user_agent) as user_agent,
    any(language) as language,
    any(timezone) as timezone,
    any(browser) as browser,
    any(browser_type) as browser_type,
    any(os) as os,
    any(device) as device,
    any(connection_type) as connection_type,

    -- Engagement (aggregated)
    max(max_scroll) as max_scroll,
    any(sdk_version) as sdk_version

FROM events
GROUP BY session_id, workspace_id;
```

**Important:** Use `events.created_at` (table-qualified) to avoid alias shadowing with `min(events.created_at) as created_at`. Use `argMin(toYear(events.created_at), events.created_at)` instead of `toYear(min(created_at))` to avoid nested aggregate function errors.

**How it works:**

1. Event inserted into `events` table
2. MV triggers, aggregates all events for that `session_id`
3. Result inserted into `sessions` table
4. ReplacingMergeTree keeps row with latest `updated_at`
5. Background merge eventually collapses to single row per session
6. Queries use `FINAL` to force collapse at query time if needed

---

## 5. Query Patterns

### 5.1 Dynamic Dimension Query (Core Use Case)

```sql
SELECT
    {dim1:Identifier},
    {dim2:Identifier},
    quantile(0.5)(duration) as median_duration,
    avg(duration) as avg_duration,
    count() as sessions
FROM sessions FINAL
WHERE workspace_id = {workspaceId:String}
  AND created_at >= {startDate:DateTime64}
  AND created_at <= {endDate:DateTime64}
GROUP BY {dim1:Identifier}, {dim2:Identifier}
ORDER BY sessions DESC
LIMIT 100;
```

**Example instantiations:**

```sql
-- By traffic source
SELECT utm_source, utm_medium, quantile(0.5)(duration), ...
GROUP BY utm_source, utm_medium

-- By device
SELECT device, browser, quantile(0.5)(duration), ...
GROUP BY device, browser

-- Single dimension
SELECT entry_page, quantile(0.5)(duration), ...
GROUP BY entry_page
```

### 5.2 Live Sessions (Active Right Now)

```sql
SELECT
    id,
    created_at,
    updated_at,
    duration,
    entry_page,
    exit_page
FROM sessions FINAL
WHERE workspace_id = {workspaceId:String}
  AND updated_at > now() - INTERVAL 5 MINUTE
ORDER BY updated_at DESC
LIMIT 50;
```

### 5.3 Session Detail (Drilldown)

```sql
SELECT
    created_at,
    name,
    path,
    duration
FROM events
WHERE workspace_id = {workspaceId:String}
  AND session_id = {sessionId:String}
ORDER BY created_at;
```

### 5.4 Overall Dashboard Metrics

```sql
SELECT
    count() as total_sessions,
    quantile(0.5)(duration) as median_duration,
    avg(duration) as avg_duration,
    quantile(0.9)(duration) as p90_duration
FROM sessions FINAL
WHERE workspace_id = {workspaceId:String}
  AND created_at >= {startDate:DateTime64}
  AND created_at <= {endDate:DateTime64};
```

### 5.5 Query Guidelines

**CRITICAL: Always include date filter for partition pruning.**

```sql
-- GOOD: Date filter enables partition pruning
SELECT ... FROM sessions FINAL
WHERE workspace_id = 'x'
  AND created_at >= today() - 7  -- ← REQUIRED
  AND created_at <= today()

-- BAD: No date filter, scans entire table
SELECT ... FROM sessions FINAL
WHERE workspace_id = 'x'  -- Slow on large tables!

-- Session lookup: Include date range
SELECT ... FROM sessions FINAL
WHERE id = 'xyz'
  AND created_at >= today() - 90  -- ← Add reasonable range
```

---

## 6. Performance Expectations

### Query Performance

| Sessions/Day | 7-Day Query | 30-Day Query |
|--------------|-------------|--------------|
| 50K | < 50ms | < 100ms |
| 500K | 50-150ms | 150-400ms |
| 5M | 150-400ms | 400-1000ms |

*With `FINAL` keyword, proper indexes, and dynamic dimensions.*

### Storage Estimates

| Events/Day | Events Storage (7d) | Sessions Storage (90d) |
|------------|---------------------|------------------------|
| 1M | ~2 GB | ~5 GB |
| 10M | ~20 GB | ~50 GB |
| 100M | ~200 GB | ~500 GB |

*With LowCardinality and ZSTD compression.*

### Latency

| Component | Latency |
|-----------|---------|
| Event → events table | < 100ms (batch insert) |
| Event → sessions table (MV) | < 1 second |
| Query (sessions FINAL) | 50-500ms |

---

## 7. Implementation Notes

### 7.1 ClickHouse Settings

```sql
-- User profile settings (apply once)
ALTER USER staminads_app SETTINGS
  -- Recommended: Only apply FINAL to queried partitions (safe because
  -- sessions are partitioned by started_at which is stable per session)
  do_not_merge_across_partitions_select_final = 1;
```

### 7.2 API Event Ingestion

**Recommended: Client-side batching** for efficiency at scale.

```typescript
class EventBuffer {
  private batch: Event[] = [];
  private readonly maxSize = 500;
  private readonly maxWaitMs = 2000;
  private timer: NodeJS.Timeout | null = null;

  async add(event: Event): Promise<void> {
    this.batch.push(event);

    if (this.batch.length === 1) {
      this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
    }

    if (this.batch.length >= this.maxSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.batch.length === 0) return;

    const events = this.batch.splice(0);
    await clickhouse.insert({ table: 'events', values: events });
  }
}
```

**Why client batching over async_insert?**

| Aspect | Client Batching | async_insert |
|--------|-----------------|--------------|
| Network calls | 1 per 500 events | 1 per event |
| Control | Full | ClickHouse decides |
| At 10K events/sec | 20 HTTP calls/sec | 10,000 HTTP calls/sec |

For low-traffic MVPs, `async_insert=1` is simpler. For production, use client batching.

### 7.3 Client-Side Duration Tracking

**Two models available - choose based on your needs:**

#### Model A: Duration on Next Page (Simpler, Industry Standard)

Used by Google Analytics, Plausible, and most analytics tools.

```typescript
class Analytics {
  private sessionId: string;
  private lastPageView: number = Date.now();

  trackPageView(path: string): void {
    const now = Date.now();
    const duration = Math.round((now - this.lastPageView) / 1000);
    this.lastPageView = now;

    this.send({
      name: 'screen_view',
      path,
      duration, // Time on PREVIOUS page
      session_id: this.getSessionId(),
    });
  }

  private getSessionId(): string {
    let id = sessionStorage.getItem('staminads_session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('staminads_session', id);
    }
    return id;
  }

  private send(event: object): void {
    navigator.sendBeacon(this.apiEndpoint, JSON.stringify(event));
  }
}
```

**Tradeoff:** Exit page duration is not captured (no event fires when tab closes).

**Why it's acceptable:**
- Session duration comes from `max(created_at) - min(created_at)` in MV
- Only per-page duration of the last page is lost
- Industry-standard approach, well-understood limitation

#### Model B: Visibility Change Ping (Optional, More Complete)

If per-page duration accuracy matters for TimeScore:

```typescript
class Analytics {
  private sessionId: string;
  private currentPath: string = '';
  private pageStartTime: number = Date.now();

  constructor(private apiEndpoint: string) {
    this.sessionId = this.getOrCreateSessionId();

    // Optional: Capture duration when user leaves/hides page
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.sendPing();
      }
    });
  }

  trackPageView(path: string): void {
    if (this.currentPath) {
      this.sendPing(); // Flush duration for previous page
    }

    this.currentPath = path;
    this.pageStartTime = Date.now();

    this.send({
      name: 'screen_view',
      path,
      duration: 0,
      session_id: this.sessionId,
    });
  }

  private sendPing(): void {
    if (!this.currentPath) return;
    const duration = Math.round((Date.now() - this.pageStartTime) / 1000);
    if (duration <= 0) return;

    navigator.sendBeacon(this.apiEndpoint, JSON.stringify({
      name: 'ping',
      path: this.currentPath,
      duration,
      session_id: this.sessionId,
    }));

    this.pageStartTime = Date.now();
  }
}
```

**Tradeoff:** More complete, but:
- `visibilitychange` isn't 100% reliable (especially iOS Safari)
- More events (ping per page view)
- More complex SDK

**Recommendation:** Start with Model A. Add Model B only if per-page duration accuracy is critical for TimeScore.

### 7.4 Handling FINAL Performance

If `FINAL` becomes slow at scale, add a scheduled optimization:

```sql
-- Run hourly to force merges
OPTIMIZE TABLE sessions FINAL;
```

Or query without `FINAL` and accept slight over-counting during merge delays (acceptable for dashboards).

---

## 8. Migration Path

### Phase 1: Deploy Schema
```sql
CREATE TABLE events ...
CREATE TABLE sessions ...
CREATE MATERIALIZED VIEW sessions_mv ...
```

### Phase 2: Backfill Sessions (if existing events)
```sql
INSERT INTO sessions
SELECT ... FROM events GROUP BY session_id, workspace_id;
```

### Phase 3: Validate
```sql
-- Compare counts
SELECT count() FROM events WHERE created_at > today() - 1;
SELECT count() FROM sessions FINAL WHERE created_at > today() - 1;
```

### Phase 4: Enable TTL
```sql
ALTER TABLE events MODIFY TTL created_at + INTERVAL 7 DAY;
```

---

## 9. Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Primary query table** | `sessions` | Pre-aggregated for fast median |
| **Update mechanism** | Materialized View | Real-time, no cron jobs |
| **Session table engine** | ReplacingMergeTree | Simple, handles updates via `updated_at` |
| **Events retention** | 7 days | Reprocessing capability without bloat |
| **Dimension storage** | Denormalized on sessions | Enables any GROUP BY combination |
| **Median function** | `quantile(0.5)` | Fast approximate, accurate enough |
| **Query modifier** | `FINAL` | Correct results from ReplacingMergeTree |

This architecture delivers:
- **Live data** (< 1 second latency)
- **Fast median** (pre-calculated duration, session-level table)
- **Dynamic dimensions** (all dimensions on session row)
- **Simplicity** (no Redis, no complex state management)

---

## 10. Design Decisions

### Aggregation Functions: `any()` vs `argMin()`

| Field Type | Function | Rationale |
|------------|----------|-----------|
| Traffic source (UTM) | `argMin()` | First-touch attribution has business meaning |
| Device/Browser/OS | `any()` | Never changes mid-session; faster |
| Geography | `any()` | Rarely changes (<1%); negligible for aggregates |

`argMin(field, created_at)` guarantees the first value but requires tracking timestamps. `any()` returns any non-null value with O(1) complexity. For dimensions that are constant within a session, the determinism of `argMin()` adds overhead without practical benefit.

### Duration Tracking Model

**Chosen:** Duration calculated from event timestamps in the Materialized View.

```sql
dateDiff('second', min(created_at), max(created_at)) as duration
```

**How it works:**
- Each `screen_view` event has a timestamp
- Session duration = last event time − first event time
- No client-side duration calculation required for session metrics

**Limitation:** Time spent on the exit page (after the last event) is not captured. This is an industry-standard limitation shared by Google Analytics and Plausible.

**Optional enhancement:** The SDK can send a `ping` event on `visibilitychange` to capture exit page time. This is provided as Model B in Section 7.3 for cases where per-page duration accuracy is critical.

### Insert Strategy: Client Batching

**Chosen:** Batch events client-side before sending to ClickHouse.

| Approach | Network Calls at 10K events/sec |
|----------|--------------------------------|
| Client batching (500 events) | 20 calls/sec |
| Single-row inserts | 10,000 calls/sec |

ClickHouse performs best with batched inserts. Client-side batching (500 events or 2 seconds, whichever comes first) reduces network overhead by 500x at scale while maintaining sub-second latency.

For MVPs with low traffic, ClickHouse's `async_insert` setting can handle batching server-side, simplifying the API code.

### Median Function: `quantile(0.5)`

**Chosen:** Reservoir sampling algorithm via `quantile()`.

For median (p50), the accuracy difference between `quantile()` and `quantileTDigest()` is <0.5%. Both are suitable.

For tail percentiles (p95, p99), `quantileTDigest()` provides better accuracy:

```sql
quantile(0.5)(duration) as median,
quantileTDigest(0.95)(duration) as p95
```

### Session Table Engine: ReplacingMergeTree

**Chosen:** `ReplacingMergeTree(updated_at)` for the sessions table.

| Engine | Syntax | Update Model |
|--------|--------|--------------|
| ReplacingMergeTree | Simple | Latest row wins (by version column) |
| AggregatingMergeTree | Complex (`State`/`Merge` functions) | Incremental aggregation |
| CollapsingMergeTree | Medium | Explicit cancel/insert pairs |

ReplacingMergeTree provides the simplest mental model: insert new versions, query with `FINAL` to get the latest. The MV naturally produces new versions as events arrive.

### What We Avoided

| Approach | Why Not Used |
|----------|--------------|
| Redis for session state | Adds infrastructure complexity; MV achieves the same result |
| Pre-aggregated dimension cubes | Can't support dynamic dimension combinations at query time |
| Heartbeat events every N seconds | Increases event volume 4x; battery impact on mobile; unnecessary for session-level metrics |
| Storing raw events indefinitely | 7-day TTL balances reprocessing capability with storage cost |
