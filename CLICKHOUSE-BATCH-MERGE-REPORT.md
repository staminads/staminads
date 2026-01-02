# ClickHouse Sessions Materialized View - Data Integrity Issue

## Problem

The sessions materialized view produces incorrect data when a session's events arrive in multiple buffer flushes.

**Root cause**: ClickHouse MVs are INSERT triggers that only see the current batch of rows. Combined with `ReplacingMergeTree(updated_at)`, the last batch's row replaces earlier ones, losing first-event data.

**When it happens**: Sessions spanning multiple batches (>500 events OR >2 seconds of activity).

---

## Broken Dimensions

| Dimension | Current MV Expression | Problem |
|-----------|----------------------|---------|
| `created_at` | `min(events.created_at)` | Returns min of last batch, not session start |
| `duration` | `dateDiff('second', min(...), max(...))` | Only spans last batch timeframe |
| `year`, `month`, `day`, `hour`, `day_of_week`, `week_number`, `is_weekend` | `argMin(toX(...), created_at)` | Derived from wrong timestamp |
| `entry_page` | `argMin(path, created_at)` | First path of last batch, not first page |

**Example**: Session starts Monday 11:58 PM, ends Tuesday 12:05 AM across 2 batches. After merge: `created_at` = Tuesday, `day_of_week` = Tuesday (should be Monday).

---

## Why Other Dimensions Are Safe

**Session-level values** (SDK sends same value with every event):
- `landing_page`, `landing_path`, `landing_domain` - captured at session creation
- `referrer`, `referrer_domain`, `referrer_path` - captured at session creation
- `utm_*` - captured at session creation
- `is_direct` - derived from referrer

**Latest-value correct**:
- `exit_page` - `argMax(path)` returns last page from last batch (correct)
- `max_scroll` - `max()` works because SDK sends cumulative value
- `updated_at` - `max(created_at)` is correct

**Device/locale** (`any()`):
- Constant per session, any batch returns correct value

---

## Fix

### SDK Change

Add `session_created_at` to event payload:

```typescript
// sdk/src/sdk.ts - sendEvent()
const payload: TrackEventPayload = {
  // ... existing fields
  session_created_at: session.created_at,  // ADD THIS
};
```

### API Change

Add column to events table:

```sql
ALTER TABLE {database}.events
ADD COLUMN session_created_at DateTime64(3) DEFAULT now64(3);
```

Add to DTO and entity:

```typescript
// dto/track-event.dto.ts
@IsOptional()
@IsNumber()
session_created_at?: number;

// events.service.ts - buildEvent()
session_created_at: dto.session_created_at
  ? new Date(dto.session_created_at)
  : new Date(),
```

### Materialized View Change

```sql
DROP VIEW IF EXISTS {database}.sessions_mv;

CREATE MATERIALIZED VIEW {database}.sessions_mv TO {database}.sessions AS
SELECT
  session_id as id,
  workspace_id,

  -- FIXED: Use SDK's session timestamp
  any(session_created_at) as created_at,
  max(events.created_at) as updated_at,

  -- FIXED: Use SDK's cumulative duration
  max(duration) as duration,

  -- FIXED: Derive from session_created_at
  any(toYear(session_created_at)) as year,
  any(toMonth(session_created_at)) as month,
  any(toDayOfMonth(session_created_at)) as day,
  any(toDayOfWeek(session_created_at)) as day_of_week,
  any(toWeek(session_created_at)) as week_number,
  any(toHour(session_created_at)) as hour,
  any(toDayOfWeek(session_created_at) IN (6, 7)) as is_weekend,

  -- FIXED: Use landing_path (already session-level)
  any(landing_path) as entry_page,
  argMax(path, events.created_at) as exit_page,

  -- Session-level (already safe)
  any(referrer) as referrer,
  any(referrer_domain) as referrer_domain,
  any(referrer_path) as referrer_path,
  any(is_direct) as is_direct,
  any(landing_page) as landing_page,
  any(landing_domain) as landing_domain,
  any(landing_path) as landing_path,
  any(utm_source) as utm_source,
  any(utm_medium) as utm_medium,
  any(utm_campaign) as utm_campaign,
  any(utm_term) as utm_term,
  any(utm_content) as utm_content,
  any(utm_id) as utm_id,
  any(utm_id_from) as utm_id_from,
  any(channel) as channel,
  any(channel_group) as channel_group,
  any(stm_1) as stm_1,
  any(stm_2) as stm_2,
  any(stm_3) as stm_3,
  any(stm_4) as stm_4,
  any(stm_5) as stm_5,
  any(stm_6) as stm_6,
  any(stm_7) as stm_7,
  any(stm_8) as stm_8,
  any(stm_9) as stm_9,
  any(stm_10) as stm_10,
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
  max(max_scroll) as max_scroll,
  any(sdk_version) as sdk_version
FROM {database}.events
GROUP BY session_id, workspace_id;
```

---

## Why This Works

Session-level values are constant across all events. When every event has the same value, `any()` returns the correct result regardless of which batch wins the merge.

| Broken | Fixed |
|--------|-------|
| `min(created_at)` - first of last batch | `any(session_created_at)` - same in every event |
| `dateDiff(min, max)` - last batch only | `max(duration)` - SDK sends cumulative |
| `argMin(path, created_at)` - wrong first page | `any(landing_path)` - same in every event |

---

## Summary

**Changes required:**
- SDK: 1 new field (`session_created_at`)
- API: 1 new column + DTO field
- MV: Update expressions

**All critical dimensions fixed.** No need for `AggregatingMergeTree` or complex migrations.
