# Staminads SDK to Analytics Data Flow Report

## Overview

Staminads is a web analytics platform that tracks user engagement through a cumulative action-based model. Data flows from the browser SDK, through API validation and transformation, into ClickHouse for storage, and finally to analytics queries that aggregate and analyze the data.

---

## 1. SDK Side: Data Generation and Transport

### 1.1 Session State Model

The SDK maintains a session with the following structure:

**File:** `sdk/src/types/session-state.ts`

```typescript
interface SessionPayload {
  workspace_id: string;           // Workspace identifier
  session_id: string;             // Session UUID
  actions: Action[];              // Cumulative array of completed actions
  current_page?: CurrentPage;     // Currently active page (not yet finalized)
  checkpoint?: number;            // Acknowledgment marker for delta sending
  attributes?: SessionAttributes; // Traffic source, device info (sent once on first payload)
  created_at: number;             // Session start timestamp (epoch ms)
  updated_at: number;             // Last interaction timestamp (epoch ms)
  sdk_version: string;            // SDK version
}
```

### 1.2 Action Types

The SDK tracks two types of actions:

**Pageview Action:**
```typescript
interface PageviewAction {
  type: 'pageview';
  path: string;                   // URL path
  page_number: number;            // Sequence within session (1-based)
  duration: number;               // Time spent on page (milliseconds)
  scroll: number;                 // Max scroll percentage (0-100)
  entered_at: number;             // When user entered page (epoch ms)
  exited_at: number;              // When user left page (epoch ms)
}
```

**Goal Action:**
```typescript
interface GoalAction {
  type: 'goal';
  name: string;                   // Goal identifier
  path: string;                   // URL path where goal triggered
  page_number: number;            // Page sequence
  timestamp: number;              // When goal triggered (epoch ms)
  value?: number;                 // Goal monetary value
  properties?: Record<string, string>; // Custom properties
}
```

### 1.3 Session Attributes (Sent Once Per Session)

```typescript
interface SessionAttributes {
  // Traffic source
  referrer?: string;              // document.referrer
  landing_page: string;           // Initial URL

  // UTM parameters
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;                // Ad click ID value
  utm_id_from?: string;           // Ad click ID source (gclid, fbclid, etc)

  // Device info (from ua-parser-js)
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device?: string;                // 'desktop', 'mobile', 'tablet'
  browser?: string;               // 'Chrome', 'Safari', 'Firefox', etc
  browser_type?: string;          // 'crawler', 'inapp', 'email', 'fetcher', 'cli', null
  os?: string;                    // 'macOS', 'Windows', 'iOS', 'Android', etc
  user_agent?: string;            // Raw user agent string
  connection_type?: string;       // '4g', '3g', '2g', 'slow-2g', ''

  // Browser APIs
  language?: string;              // BCP 47 format
  timezone?: string;              // IANA timezone
}
```

### 1.4 Delta Sending with Checkpoint

The SDK uses **checkpoint-based delta sending** to optimize bandwidth:

- `actions` is a **cumulative array** - all actions ever taken in the session
- `checkpoint` marks the last acknowledged action index (server echoes this back)
- On next send, SDK only includes NEW actions: `actions[checkpoint+1:]`
- Server processes only new actions: `payload.actions.slice(checkpoint + 1)`

**Example Flow:**
```
Send 1: actions=[PV1], checkpoint=undefined → Server processes PV1, returns checkpoint=0
Send 2: actions=[PV1, PV2, Goal1], checkpoint=0 → Server processes [PV2, Goal1], returns checkpoint=2
Send 3: actions=[PV1, PV2, Goal1, PV3], checkpoint=2 → Server processes [PV3], returns checkpoint=3
```

### 1.5 Data Transport

**File:** `sdk/src/transport/sender.ts`

The SDK sends via fetch to `POST /api/track`:

```typescript
async sendSession(payload: SessionPayload): Promise<SendResult> {
  const url = `${this.endpoint}/api/track`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,  // Survives page unload
  });

  // Server responds with:
  return { success: true, checkpoint: data.checkpoint };
}
```

**Fallback Strategies:**
1. Fetch with `keepalive: true` (modern browsers)
2. Navigator.sendBeacon (15KB limit for Safari compatibility)
3. Offline queue with retry (localStorage)

---

## 2. API Handler Side: Reception and Processing

### 2.1 The Track Endpoint

**File:** `api/src/events/events.controller.ts`

```typescript
@Post('track')
@UseGuards(AuthGuard('api-key'), ScopeGuard, WorkspaceGuard)
@RequireScope('events.track')
async track(
  @Body() payload: SessionPayloadDto,
  @ClientIp() clientIp: string | null,
) {
  return this.sessionPayloadHandler.handle(payload, clientIp);
}
```

**Features:**
- API key authentication (workspace validation)
- Rate limit skipped (high-volume endpoint - millions of devices may share same IP)
- Extracts client IP for geo-location

### 2.2 Request Validation

**File:** `api/src/events/dto/session-payload.dto.ts`

Validates incoming payloads with constraints:

```typescript
class SessionPayloadDto {
  @IsNotEmpty()
  workspace_id: string;

  @IsNotEmpty()
  session_id: string;

  @ArrayMaxSize(1000)  // Max 1000 actions per payload
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: PageviewActionDto, name: 'pageview' },
        { value: GoalActionDto, name: 'goal' },
      ],
    },
  })
  actions: (PageviewActionDto | GoalActionDto)[];

  @Min(0)
  checkpoint?: number;

  @ValidateNested()
  attributes?: SessionAttributesDto;

  @IsWithinTimeBounds(24)  // Timestamps must be within 24 hours
  created_at: number;

  @IsWithinTimeBounds(24)
  updated_at: number;

  sdk_version?: string;
}
```

Constraints:
- Max 1000 actions per payload
- Max 2048 chars per path
- Max 100 chars for goal names
- Timestamps within +/- 24 hours of server time

### 2.3 Handler: SessionPayloadHandler

**File:** `api/src/events/session-payload.handler.ts`

The handler orchestrates processing:

```typescript
async handle(payload: SessionPayloadDto, clientIp: string | null): Promise<HandleResult> {
  // 1. Validate workspace exists
  const workspace = await this.getWorkspace(payload.workspace_id);

  // 2. Filter actions by checkpoint (delta processing)
  const startIndex = (payload.checkpoint ?? -1) + 1;
  const actionsToProcess = payload.actions.slice(startIndex);

  if (actionsToProcess.length === 0) {
    return { success: true, checkpoint: payload.actions.length };
  }

  // 3. Perform geo lookup once
  const geo = this.geoService.lookupWithSettings(clientIp, workspace.settings);

  // 4. Set _version (conflict resolution timestamp) - same for entire payload
  const version = Date.now();

  // 5. Build base event from session attributes (static data)
  const baseEvent = this.buildBaseEvent(payload, geo, version);

  // 6. Deserialize each action to a tracking event
  const events: TrackingEvent[] = [];
  let previousPath = '';

  // Build previous_path chain
  for (let i = 0; i < startIndex && i < payload.actions.length; i++) {
    const action = payload.actions[i];
    if (isPageviewAction(action)) {
      previousPath = action.path;
    }
  }

  for (const action of actionsToProcess) {
    const event = this.deserializeAction(action, baseEvent, payload.session_id, previousPath);
    events.push(event);
    if (isPageviewAction(action)) {
      previousPath = action.path;
    }
  }

  // 7. Apply filters from workspace settings
  const filters = workspace.settings.filters ?? [];
  if (filters.length > 0) {
    for (const event of events) {
      this.applyFilters(event, filters);
    }
  }

  // 8. Add events to buffer for batch writing
  await this.buffer.addBatch(events);

  return { success: true, checkpoint: payload.actions.length };
}
```

### 2.4 Data Transformations

**Base Event Construction:**

The handler builds a `baseEvent` from static session attributes:

```typescript
private buildBaseEvent(
  payload: SessionPayloadDto,
  geo: GeoLocation,
  version: number,
): Partial<TrackingEvent> {
  const attrs = payload.attributes;
  const now = toClickHouseDateTime();

  // Parse URLs for derived fields
  const referrerParsed = this.parseUrl(attrs?.referrer);
  const landingParsed = this.parseUrl(attrs?.landing_page);

  return {
    session_id: payload.session_id,
    workspace_id: payload.workspace_id,
    received_at: now,                    // Server timestamp
    created_at: toClickHouseDateTime(new Date(payload.created_at)),  // SDK session start
    updated_at: toClickHouseDateTime(new Date(payload.updated_at)),  // SDK last interaction
    _version: version,                   // Conflict resolution

    // Parsed traffic source
    referrer: attrs?.referrer ?? '',
    referrer_domain: referrerParsed.domain ?? '',
    referrer_path: referrerParsed.path ?? '',
    is_direct: !attrs?.referrer,

    // Landing page
    landing_page: attrs?.landing_page ?? '',
    landing_domain: landingParsed.domain ?? '',
    landing_path: landingParsed.path ?? '',

    // UTM parameters
    utm_source: attrs?.utm_source ?? '',
    utm_medium: attrs?.utm_medium ?? '',
    utm_campaign: attrs?.utm_campaign ?? '',
    utm_term: attrs?.utm_term ?? '',
    utm_content: attrs?.utm_content ?? '',
    utm_id: attrs?.utm_id ?? '',
    utm_id_from: attrs?.utm_id_from ?? '',

    // Device info
    screen_width: attrs?.screen_width ?? 0,
    screen_height: attrs?.screen_height ?? 0,
    viewport_width: attrs?.viewport_width ?? 0,
    viewport_height: attrs?.viewport_height ?? 0,
    device: attrs?.device ?? '',
    browser: attrs?.browser ?? '',
    browser_type: attrs?.browser_type ?? '',
    os: attrs?.os ?? '',
    user_agent: attrs?.user_agent ?? '',
    connection_type: attrs?.connection_type ?? '',

    // Browser APIs
    language: attrs?.language ?? '',
    timezone: attrs?.timezone ?? '',

    // Geo (derived from IP, IP is never stored)
    country: geo.country ?? '',
    region: geo.region ?? '',
    city: geo.city ?? '',
    latitude: geo.latitude,
    longitude: geo.longitude,

    // SDK version
    sdk_version: payload.sdk_version ?? '',

    // Defaults
    channel: '',
    channel_group: '',
    stm_1: '', stm_2: '', stm_3: '', stm_4: '', stm_5: '',
    stm_6: '', stm_7: '', stm_8: '', stm_9: '', stm_10: '',
  };
}
```

**Action Deserialization - Pageview:**

```typescript
private deserializePageview(
  action: PageviewActionDto,
  baseEvent: Partial<TrackingEvent>,
  sessionId: string,
  previousPath: string,
): TrackingEvent {
  return {
    ...baseEvent,
    dedup_token: `${sessionId}_pv_${action.page_number}`,  // Deterministic dedup key
    name: 'screen_view',
    path: action.path,
    page_number: action.page_number,
    duration: action.duration,
    page_duration: action.duration,
    max_scroll: action.scroll,
    previous_path: previousPath,  // For attribution chains
    goal_name: '',
    goal_value: 0,
    properties: {},

    // SDK timestamps (in ClickHouse DateTime format)
    entered_at: toClickHouseDateTime(new Date(action.entered_at)),
    exited_at: toClickHouseDateTime(new Date(action.exited_at)),
    goal_timestamp: '',
  };
}
```

**Action Deserialization - Goal:**

```typescript
private deserializeGoal(
  action: GoalActionDto,
  baseEvent: Partial<TrackingEvent>,
  sessionId: string,
): TrackingEvent {
  return {
    ...baseEvent,
    dedup_token: `${sessionId}_goal_${action.name}_${action.timestamp}`,
    name: 'goal',
    path: action.path,
    page_number: action.page_number,
    duration: 0,
    page_duration: 0,
    max_scroll: 0,
    previous_path: '',
    goal_name: action.name,
    goal_value: action.value ?? 0,
    properties: action.properties ?? {},

    // SDK timestamp
    entered_at: '',
    exited_at: '',
    goal_timestamp: toClickHouseDateTime(new Date(action.timestamp)),
  };
}
```

---

## 3. Database Storage: ClickHouse Schemas

### 3.1 Events Table (Raw Events)

**File:** `api/src/database/schemas.ts`

```sql
CREATE TABLE IF NOT EXISTS {database}.events (
  -- Identity
  id UUID DEFAULT generateUUIDv4(),
  session_id String,
  workspace_id String,

  -- Timestamps
  received_at DateTime64(3),        -- Server receive time
  created_at DateTime64(3),         -- SDK session start (same for all events in session)
  updated_at DateTime64(3),         -- SDK last interaction (varies per event)
  name LowCardinality(String),      -- 'screen_view', 'goal'

  -- Page info
  path String,                      -- Current page path
  page_duration UInt32,             -- Duration on page
  previous_path String,             -- Attribution chain
  page_number UInt16,               -- Page sequence

  -- Traffic source (from session attributes)
  referrer String,
  referrer_domain String,
  referrer_path String,
  is_direct Bool,
  landing_page String,
  landing_domain String,
  landing_path String,

  -- UTM
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  utm_id String,
  utm_id_from String,
  channel LowCardinality(String),
  channel_group LowCardinality(String),

  -- Custom dimensions (stm_1 through stm_10)
  stm_1 String, stm_2 String, ... stm_10 String,

  -- Device (from session attributes)
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

  -- Browser APIs
  language String,
  timezone String,

  -- Geo (derived from IP, IP never stored)
  country LowCardinality(String),
  region LowCardinality(String),
  city String,
  latitude Nullable(Float32),
  longitude Nullable(Float32),

  -- Engagement
  duration UInt64,                  -- Session duration
  max_scroll UInt8,                 -- Page scroll %

  -- Goal data
  goal_name String,
  goal_value Float32,

  -- SDK info
  sdk_version String,

  -- Technical
  _version UInt64,                  -- Conflict resolution
  dedup_token String,               -- Deduplication key
  properties Map(String, String),   -- Flexible properties

  -- SDK timestamps
  entered_at DateTime64(3),
  exited_at DateTime64(3),
  goal_timestamp DateTime64(3),

  -- Indexes
  INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (session_id, received_at)
TTL toDateTime(received_at) + INTERVAL 7 DAY
```

**Key Design Decisions:**
- Partitioned by date (for efficient queries)
- Ordered by (session_id, received_at) for fast sequential reads
- 7-day TTL for automatic cleanup
- _version for conflict resolution in ReplacingMergeTree
- dedup_token for idempotency

### 3.2 Sessions Table (Aggregated Session-Level Data)

```sql
CREATE TABLE IF NOT EXISTS {database}.sessions (
  -- Identity
  id String,
  workspace_id String,

  -- Timestamps
  created_at DateTime64(3),
  updated_at DateTime64(3),

  -- Metrics
  duration UInt32,                  -- Session total duration
  pageview_count UInt16,            -- Number of pages visited
  median_page_duration UInt32,      -- Median time on page
  goal_count UInt16,                -- Number of goals
  goal_value Float32,               -- Total goal value

  -- Time dimensions (derived from created_at)
  year UInt16,
  month UInt8,
  day UInt8,
  day_of_week UInt8,
  week_number UInt8,
  hour UInt8,
  is_weekend Bool,

  -- Traffic source
  referrer String,
  referrer_domain String,
  referrer_path String,
  is_direct Bool,
  landing_page String,
  landing_domain String,
  landing_path String,
  exit_path String,

  -- UTM
  utm_source String,
  utm_medium String,
  utm_campaign String,
  utm_term String,
  utm_content String,
  utm_id String,
  utm_id_from String,
  channel LowCardinality(String),
  channel_group LowCardinality(String),

  -- Custom dimensions
  stm_1 String, stm_2 String, ... stm_10 String,

  -- Device
  screen_width UInt16,
  screen_height UInt16,
  viewport_width UInt16,
  viewport_height UInt16,
  user_agent String,
  language String,
  timezone String,
  browser String,
  browser_type String,
  os String,
  device String,
  connection_type String,

  -- Geo
  country LowCardinality(String),
  region LowCardinality(String),
  city String,
  latitude Nullable(Float32),
  longitude Nullable(Float32),

  -- Engagement
  max_scroll UInt8,

  -- SDK
  sdk_version String,

  -- Indexing
  INDEX idx_created_at created_at TYPE minmax GRANULARITY 1
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, id)
```

### 3.3 Sessions Materialized View (Auto-Aggregation)

The `sessions_mv` automatically aggregates events into session summaries:

```sql
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
  medianIf(e.page_duration, e.page_duration > 0) as median_page_duration,

  -- Time dimensions
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
  ... (all other fields)

  -- Exit path (last path in session)
  argMax(e.path, e.updated_at) as exit_path,

  -- Goal metrics
  countIf(e.name = 'goal') as goal_count,
  sumIf(e.goal_value, e.name = 'goal') as goal_value

FROM {database}.events e
GROUP BY e.session_id, e.workspace_id
```

**Key Features:**
- Automatically groups all events in a session
- Uses `any()` for static fields (same for entire session)
- Uses `max()` for updated_at (latest event)
- Uses `argMax()` for exit_path (last path visited)
- Counts pageviews and goals
- Derives time dimensions from session created_at

### 3.4 Pages Table (Per-Page Analytics)

```sql
CREATE TABLE IF NOT EXISTS {database}.pages (
  -- Identity
  id UUID DEFAULT generateUUIDv4(),
  page_id String,              -- Composite key: session_id_page_number
  session_id String,
  workspace_id String,

  -- Page info
  path String,
  full_url String,

  -- Timestamps
  entered_at DateTime64(3),
  exited_at DateTime64(3),

  -- Engagement
  duration UInt32,
  max_scroll UInt8,

  -- Sequence
  page_number UInt16,
  is_landing Bool,
  is_exit Bool,
  entry_type LowCardinality(String),  -- 'landing' or 'navigation'

  -- Technical
  received_at DateTime64(3) DEFAULT now64(3),
  _version UInt64 DEFAULT 0
)
ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (session_id, page_number)
TTL toDateTime(received_at) + INTERVAL 7 DAY
```

### 3.5 Pages Materialized View

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS {database}.pages_mv
TO {database}.pages AS
SELECT
  generateUUIDv4() as id,
  concat(e.session_id, '_', toString(e.page_number)) as page_id,
  e.session_id,
  e.workspace_id,
  e.path,
  e.landing_page as full_url,

  -- Use actual SDK timestamps
  e.entered_at as entered_at,
  e.exited_at as exited_at,
  e.page_duration as duration,
  e.max_scroll,
  e.page_number,

  -- Derived flags
  e.path = e.landing_path as is_landing,
  0 as is_exit,
  if(e.path = e.landing_path, 'landing', 'navigation') as entry_type,

  now64(3) as received_at,
  e._version

FROM {database}.events e
WHERE e.name = 'screen_view' AND e.page_duration > 0
```

---

## 4. Analytics Queries: Data Retrieval and Aggregation

### 4.1 Query Architecture

**File:** `api/src/analytics/lib/query-builder.ts`

The query builder dynamically constructs ClickHouse SQL from a request DTO:

```typescript
interface AnalyticsQueryDto {
  workspace_id: string;

  // Metrics (what to measure: count, avg, median, etc)
  metrics: string[];

  // Dimensions (what to group by: browser, device, utm_source, etc)
  dimensions?: string[];

  // Filters
  filters?: FilterDto[];

  // Date range
  dateRange: {
    preset?: 'today' | 'yesterday' | 'previous_7_days' | ... | 'all_time'
    start?: string;    // Or explicit ISO dates
    end?: string;
    granularity?: 'hour' | 'day' | 'week' | 'month' | 'year'
  };

  // Comparison period (for YoY, WoW comparisons)
  compareDateRange?: DateRangeDto;

  // Timezone (for user-local date grouping)
  timezone?: string;

  // Ordering
  order?: Record<string, 'asc' | 'desc'>;

  // Pagination
  limit?: number;  // max 10000

  // Aggregation threshold
  havingMinSessions?: number;

  // Table selection
  table?: 'sessions' | 'pages' | 'events';
}
```

### 4.2 Available Metrics

**File:** `api/src/analytics/constants/metrics.ts`

| Metric | SQL | Tables | Description |
|--------|-----|--------|-------------|
| `sessions` | `count()` | sessions | Total sessions |
| `median_duration` | `round(median(duration), 1)` | sessions | Median session duration |
| `max_scroll` | `round(avg(max_scroll), 1)` | sessions | Avg max scroll depth (%) |
| `median_scroll` | `round(median(max_scroll), 1)` | sessions | Median scroll depth |
| `bounce_rate` | `round(countIf(duration < threshold) * 100 / count(), 2)` | sessions | Bounce % (configurable) |
| `pageviews` | `countIf(name = 'screen_view')` | sessions | Total pageviews |
| `pages_per_session` | `round(avg(pageview_count), 2)` | sessions | Avg pages per session |
| `median_page_duration` | `round(median(median_page_duration), 1)` | sessions | Median time on page |
| `page_count` | `count()` | pages | Total page views |
| `unique_pages` | `uniqExact(path)` | pages | Unique page paths |
| `page_duration` | `round(median(duration), 1)` | pages | Median time on page |
| `page_scroll` | `round(median(max_scroll), 1)` | pages | Median scroll depth |
| `landing_page_count` | `countIf(is_landing = true)` | pages | Landing page views |
| `exit_page_count` | `countIf(is_exit = true)` | pages | Exit page views |
| `exit_rate` | `round(countIf(is_exit = true) * 100 / count(), 2)` | pages | Exit % |

### 4.3 Query Execution Flow

**File:** `api/src/analytics/analytics.service.ts`

```typescript
async query(dto: AnalyticsQueryDto): Promise<AnalyticsResponse> {
  // 1. Validate workspace and get timezone
  const workspace = await this.workspacesService.get(dto.workspace_id);
  const tz = dto.timezone || workspace.timezone || 'UTC';

  // 2. Resolve date preset to absolute dates
  const resolvedDates = dto.dateRange.preset
    ? resolveDatePreset(dto.dateRange.preset, tz)
    : { start: dto.dateRange.start!, end: dto.dateRange.end! };

  // 3. Generate cache key and check cache
  const cacheKey = this.generateCacheKey(dto, resolvedDates, tz);
  const cached = await this.cacheManager.get<AnalyticsResponse>(cacheKey);
  if (cached) return cached;

  // 4. Deduplicate concurrent identical requests
  if (this.pendingQueries.has(cacheKey)) {
    return this.pendingQueries.get(cacheKey)!;
  }

  // 5. Build and execute query
  const { sql, params } = buildAnalyticsQuery(dto, tz, metricContext);
  let data = await this.clickhouse.queryWorkspace(
    dto.workspace_id,
    sql,
    params,
  );

  // 6. Fill gaps for time series (if granularity specified)
  if (granularity && resolvedDates.start && resolvedDates.end) {
    data = fillGaps(
      data,
      granularity,
      dateColumn,
      resolvedDates.start,
      resolvedDates.end,
      dto.metrics,
      dto.dimensions || [],
    );
  }

  // 7. Cache result (5 min for historical, 1 min for live including today)
  const ttl = this.getTTL(resolvedDates, tz);
  await this.cacheManager.set(cacheKey, result, ttl);

  return result;
}
```

### 4.4 Generated SQL Example

For a query like:
```json
{
  "workspace_id": "ws_123",
  "metrics": ["sessions", "median_duration"],
  "dimensions": ["browser", "device"],
  "dateRange": { "start": "2025-01-01", "end": "2025-01-08", "granularity": "day" },
  "timezone": "America/New_York",
  "table": "sessions"
}
```

The builder generates:

```sql
SELECT
  toDate(created_at, 'America/New_York') as date_day,
  browser,
  device,
  count() as sessions,
  round(median(duration), 1) as median_duration
FROM sessions
WHERE
  created_at >= toDateTime64('2025-01-01 00:00:00.000', 3)
  AND created_at <= toDateTime64('2025-01-08 23:59:59.999', 3)
GROUP BY date_day, browser, device
ORDER BY date_day ASC
LIMIT 1000
```

### 4.5 Comparison Queries

For year-over-year or period-over-period comparisons:

```typescript
// If both periods use same preset, auto-shift comparison to previous period
if (dto.compareDateRange.preset === dto.dateRange.preset) {
  const shifted = shiftPresetToPreviousPeriod(dto.dateRange.preset, tz);
  compareDateRange = shifted;
}

// Execute both queries in parallel
const [currentData, previousData] = await Promise.all([
  this.clickhouse.queryWorkspace(dto.workspace_id, currentSql, currentParams),
  this.clickhouse.queryWorkspace(dto.workspace_id, previousSql, previousParams),
]);

// Return both datasets for client-side comparison
return {
  data: { current: currentData, previous: previousData },
  meta: { ... },
};
```

---

## 5. Data Flow Summary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER / SDK                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Session State (localStorage):                           │ │
│  │ - actions: [PV1, PV2, Goal1, PV3] (cumulative)          │ │
│  │ - checkpoint: 2 (last acknowledged)                     │ │
│  │ - attributes: {device, utm, referrer, etc}              │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ POST /api/track
                       │ {actions, checkpoint, attributes}
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     API HANDLER                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 1. Validation (workspace, auth, timestamp bounds)       │ │
│  │ 2. Delta filtering: new_actions = actions[checkpoint+1] │ │
│  │ 3. Geo lookup (IP → country, region, city)              │ │
│  │ 4. Build baseEvent from attributes                      │ │
│  │ 5. Deserialize each action:                             │ │
│  │    - Pageview → {name: 'screen_view', ...}              │ │
│  │    - Goal → {name: 'goal', goal_name, goal_value}       │ │
│  │ 6. Apply workspace filters (custom dimensions, etc)     │ │
│  │ 7. Add events to buffer                                 │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ Response: {success: true, checkpoint: 3}
                       │ (SDK updates checkpoint, incremental sends)
                       │
                       │ Add events to buffer
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               CLICKHOUSE STORAGE                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ events table (raw events):                              │ │
│  │ - session_id, name, path, duration, scroll, ...         │ │
│  │ - received_at (server time), created_at (SDK time)      │ │
│  │ - Device, UTM, geo, custom dimensions                   │ │
│  │ - Partitioned by date, ordered by (session, time)       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                       │                                      │
│                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ sessions_mv → sessions table (auto-aggregation):        │ │
│  │ - Counts pageviews, sums goals, finds median duration   │ │
│  │ - Derives time dimensions (year, month, day, hour)      │ │
│  │ - Session-level summary (1 row per session)             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                       │                                      │
│                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ pages_mv → pages table (per-page analytics):            │ │
│  │ - Each pageview → one row                               │ │
│  │ - Page duration, scroll, landing/exit flags             │ │
│  │ - Entry type (landing vs navigation)                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ Analytics queries
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 ANALYTICS QUERIES                            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 1. Parse query DTO (metrics, dimensions, filters)       │ │
│  │ 2. Validate against available metrics/dimensions        │ │
│  │ 3. Build SQL from metrics definitions                   │ │
│  │ 4. Apply filters (browser, device, utm, custom)         │ │
│  │ 5. Apply timezone for user-local date grouping          │ │
│  │ 6. Execute in workspace-specific database               │ │
│  │ 7. Fill gaps for time series if granular                │ │
│  │ 8. Cache result (5 min historical, 1 min live)          │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ {data, meta, query}
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 FRONTEND / DASHBOARD                         │
│  Displays trends, comparisons, dimensions, filters           │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Key Data Flow Characteristics

### 6.1 Cumulative Action Arrays with Checkpoint

- SDK maintains **all actions ever taken** in session
- Server processes only **new actions** (since last checkpoint)
- Server echoes back `checkpoint: actions.length` to acknowledge
- Enables **delta/incremental** sending to reduce bandwidth
- Provides **idempotency** - safe to resend same payload

### 6.2 Timestamp Preservation

- **created_at**: Session start (from SDK, stored in events/sessions)
- **updated_at**: Last interaction (from SDK, stored per event)
- **received_at**: Server receive time (for latency detection)
- All timestamps stored in **millisecond precision** (DateTime64(3))

### 6.3 Deduplication Strategies

- **dedup_token**: Deterministic key `${sessionId}_pv_${pageNumber}` or `${sessionId}_goal_${name}_${timestamp}`
- **_version**: Server timestamp for conflict resolution (ReplacingMergeTree)
- Prevents duplicate events from retransmissions

### 6.4 Session-Level Data Preservation

- **Session attributes** (device, traffic source, UTM) sent **once per session**
- Attached to **every event** in that session for easy filtering
- Enables fast queries: no need to JOIN events with session metadata

### 6.5 Automatic Aggregation

- **sessions_mv** automatically groups events by session
- **pages_mv** automatically extracts pageviews as separate rows
- No manual aggregation needed - materialized views handle it
- Real-time updates as events arrive

### 6.6 Geographic Enrichment

- Client IP extracted from request
- Mapped to country, region, city (IP never stored)
- Optional city/region/coordinates storage (workspace settings)
- Enrichment happens at event ingestion time

### 6.7 Timezone-Aware Analytics

- Workspace has default timezone
- Analytics queries can override with custom timezone
- Date grouping (day, week, month) respects user's timezone
- Prevents off-by-one errors in date bucketing

### 6.8 Caching Strategy

- **Live queries** (including today): 1-minute cache
- **Historical queries** (past data): 5-minute cache
- Cache invalidated on filter changes or backfill completion
- Request deduplication: concurrent identical queries share single execution

---

## 7. Schema Relationships

```
┌─────────────────────────────────┐
│         events (raw)            │
│ ┌─────────────────────────────┐ │
│ │ id, session_id, name, path, │ │
│ │ duration, scroll, device,   │ │
│ │ utm_*, stm_*, goal_*, ...   │ │
│ └─────────────────────────────┘ │
│              │ MV               │
│              ▼                  │
│  ┌─────────────────────────┐   │
│  │ sessions (aggregated)   │   │
│  │ ┌─────────────────────┐ │   │
│  │ │ 1 row per session   │ │   │
│  │ │ count pageviews     │ │   │
│  │ │ sum goals           │ │   │
│  │ │ median page_dur     │ │   │
│  │ │ exit_path (last)    │ │   │
│  │ └─────────────────────┘ │   │
│  └─────────────────────────┘   │
│              │ MV               │
│              ▼                  │
│  ┌─────────────────────────┐   │
│  │  pages (per-page)       │   │
│  │ ┌─────────────────────┐ │   │
│  │ │ 1 row per pageview  │ │   │
│  │ │ path, duration,     │ │   │
│  │ │ scroll, landing flag│ │   │
│  │ └─────────────────────┘ │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

---

## 8. Example End-to-End Flow

### User Journey:
1. User lands on `example.com/?utm_source=google`
2. Spends 5 seconds on `/pricing`, scrolls 40%
3. Clicks link to `/features`
4. Spends 12 seconds on `/features`, scrolls 80%
5. Completes purchase goal

### SDK Side:
```javascript
// Initial payload
{
  workspace_id: 'ws_123',
  session_id: 'sess_abc',
  actions: [
    {
      type: 'pageview',
      path: '/pricing',
      page_number: 1,
      duration: 5000,
      scroll: 40,
      entered_at: 1704067200000,
      exited_at: 1704067205000
    }
  ],
  attributes: {
    landing_page: 'https://example.com/?utm_source=google',
    utm_source: 'google',
    device: 'desktop',
    browser: 'Chrome',
    os: 'macOS',
    language: 'en-US',
    timezone: 'America/New_York'
  },
  created_at: 1704067200000,
  updated_at: 1704067205000,
  sdk_version: '5.0.0'
}
// Server returns: { success: true, checkpoint: 0 }

// Second payload (delta)
{
  workspace_id: 'ws_123',
  session_id: 'sess_abc',
  actions: [
    { type: 'pageview', path: '/pricing', ... },
    {
      type: 'pageview',
      path: '/features',
      page_number: 2,
      duration: 12000,
      scroll: 80,
      entered_at: 1704067205000,
      exited_at: 1704067217000
    }
  ],
  checkpoint: 0,  // Last acknowledged index
  attributes: { ... },  // Only sent if attributes changed
  created_at: 1704067200000,
  updated_at: 1704067217000
}
// Server processes only action at index 1 (the /features pageview)
// Returns: { success: true, checkpoint: 1 }

// Third payload (goal)
{
  workspace_id: 'ws_123',
  session_id: 'sess_abc',
  actions: [
    { type: 'pageview', path: '/pricing', ... },
    { type: 'pageview', path: '/features', ... },
    {
      type: 'goal',
      name: 'purchase',
      path: '/checkout/success',
      page_number: 3,
      timestamp: 1704067220000,
      value: 99.99,
      properties: { order_id: 'ord_123', currency: 'USD' }
    }
  ],
  checkpoint: 1,
  created_at: 1704067200000,
  updated_at: 1704067220000
}
// Server processes only action at index 2 (the goal)
// Returns: { success: true, checkpoint: 2 }
```

### Database Events Created:
```sql
-- Event 1: Pageview on /pricing
INSERT INTO events VALUES (
  session_id='sess_abc',
  name='screen_view',
  path='/pricing',
  page_number=1,
  duration=5000,
  page_duration=5000,
  max_scroll=40,
  previous_path='',
  landing_page='https://example.com/?utm_source=google',
  utm_source='google',
  device='desktop',
  browser='Chrome',
  os='macOS',
  language='en-US',
  timezone='America/New_York',
  goal_name='',
  goal_value=0,
  entered_at='2025-01-01 00:00:00',
  exited_at='2025-01-01 00:00:05',
  created_at='2025-01-01 00:00:00',
  received_at='2025-01-01 00:00:01',  -- Server time
  _version=1704067201000,
  dedup_token='sess_abc_pv_1',
  ...
)

-- Event 2: Pageview on /features
INSERT INTO events VALUES (
  session_id='sess_abc',
  name='screen_view',
  path='/features',
  page_number=2,
  duration=12000,
  page_duration=12000,
  max_scroll=80,
  previous_path='/pricing',  -- Attribution chain
  ... (rest of fields from baseEvent)
  entered_at='2025-01-01 00:00:05',
  exited_at='2025-01-01 00:00:17',
  created_at='2025-01-01 00:00:00',  -- Same for entire session
  received_at='2025-01-01 00:00:06',
  _version=1704067206000,
  dedup_token='sess_abc_pv_2',
  ...
)

-- Event 3: Goal - Purchase
INSERT INTO events VALUES (
  session_id='sess_abc',
  name='goal',
  path='/checkout/success',
  page_number=3,
  duration=0,
  page_duration=0,
  max_scroll=0,
  previous_path='',
  goal_name='purchase',
  goal_value=99.99,
  properties={'order_id': 'ord_123', 'currency': 'USD'},
  entered_at='',
  exited_at='',
  goal_timestamp='2025-01-01 00:00:20',
  created_at='2025-01-01 00:00:00',
  received_at='2025-01-01 00:00:07',
  _version=1704067207000,
  dedup_token='sess_abc_goal_purchase_1704067220000',
  ...
)
```

### Aggregated Sessions Row:
```sql
SELECT * FROM sessions WHERE id = 'sess_abc'
-- Returns:
id='sess_abc',
pageview_count=2,
median_page_duration=8500,  -- median of [5000, 12000]
duration=17000,             -- max duration in events
goal_count=1,
goal_value=99.99,
max_scroll=80,              -- max of [40, 80]
landing_page='https://example.com/?utm_source=google',
utm_source='google',
device='desktop',
browser='Chrome',
exit_path='/checkout/success',
... (all session-level fields from attributes)
created_at='2025-01-01 00:00:00',
updated_at='2025-01-01 00:00:20',
```

### Analytics Query:
```json
{
  "workspace_id": "ws_123",
  "metrics": ["sessions", "median_duration", "pageviews"],
  "dimensions": ["device", "utm_source"],
  "dateRange": {
    "start": "2025-01-01",
    "end": "2025-01-08",
    "granularity": "day"
  }
}
```

Returns:
```json
{
  "data": [
    {
      "date_day": "2025-01-01",
      "device": "desktop",
      "utm_source": "google",
      "sessions": 1,
      "median_duration": 17,
      "pageviews": 2
    }
  ],
  "meta": {
    "metrics": ["sessions", "median_duration", "pageviews"],
    "dimensions": ["device", "utm_source"],
    "granularity": "day",
    "dateRange": { "start": "2025-01-01", "end": "2025-01-08" },
    "total_rows": 1
  }
}
```

---

## Summary

The Staminads data flow represents a modern analytics architecture:

1. **SDK** sends cumulative action arrays with delta checkpoints for efficient transmission
2. **API** validates, enriches with geo data, deserializes actions, and applies custom filters
3. **ClickHouse** stores raw events with full fidelity and automatic session/page aggregation
4. **Materialized views** provide real-time session and page summaries
5. **Analytics queries** dynamically build SQL for flexible aggregation across metrics, dimensions, and time ranges
6. **Caching** optimizes repeated queries while maintaining freshness

This architecture supports zero data loss (cumulative arrays), exact duration tracking (millisecond timestamps), efficient bandwidth (delta sending), and flexible analytics (dynamic SQL generation).
