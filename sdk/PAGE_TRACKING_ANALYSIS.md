# Comprehensive Report: Page Duration Tracking Analysis

**Date**: 2026-01-08 (Updated)
**SDK Version**: v5.0.0
**Scope**: SDK → Events → Database → Analytics query flow

## Executive Summary

After tracing the complete data flow from SDK → Events → Database → Analytics, the page duration tracking system is now **largely functional**. The core calculation logic in the SDK is sound, and the analytics API properly exposes per-page data.

**Previous Analysis Status**: The v3 implementation addressed many issues from the original analysis (page_duration field, previous_path tracking, pages table). Subsequent updates have also addressed the critical gap in analytics API exposure. Some design debt remains in timestamp handling and page sequencing.

---

## Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SDK (sdk.ts)                                                                │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 1. Initial screen_view (no page_duration - landing page)                │ │
│ │ 2. SPA Navigation → screen_view with previous page's duration           │ │
│ │ 3. Unload/Hide → ping with current page's duration                      │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ Events Table (events)                                                       │
│ - page_duration: UInt32 (time on page in seconds)                          │
│ - previous_path: String (which page the duration belongs to)               │
│ - path: String (current page)                                              │
│ - name: screen_view | ping | scroll | goal                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
          ┌─────────────────────────┴─────────────────────────┐
          ↓                                                   ↓
┌─────────────────────────────┐              ┌─────────────────────────────┐
│ Sessions MV → sessions      │              │ Pages MV → pages            │
│                             │              │                             │
│ median_page_duration =      │              │ WHERE:                      │
│   medianIf(page_duration,   │              │   (screen_view AND          │
│         page_duration > 0)  │              │    previous_path != '' AND  │
│                             │              │    page_duration > 0)       │
│ pageview_count =            │              │   OR                        │
│   countIf(name='screen_view')│             │   (ping AND page_duration>0)│
└─────────────────────────────┘              └─────────────────────────────┘
          ↓                                                   ↓
┌─────────────────────────────┐              ┌─────────────────────────────┐
│ Analytics API               │              │ Analytics API               │
│ table=sessions (default)    │              │ table=pages                 │
│                             │              │                             │
│ median_page_duration:       │              │ page_duration metric:       │
│   median(median_page_duration)│            │   median(duration)          │
│                             │              │                             │
│ dimensions: landing_page,   │              │ dimensions: page_path,      │
│   exit_path, etc.           │              │   is_landing_page, etc.     │
└─────────────────────────────┘              └─────────────────────────────┘
```

---

## Identified Issues

### ✅ RESOLVED: Issue #1 - Per-Page Analytics Now Available

**Location**: `api/src/analytics/constants/dimensions.ts`, `api/src/analytics/constants/tables.ts`, `api/src/analytics/lib/query-builder.ts`

**Previous Problem**: The analytics system only queried the `sessions` table with no `path` dimension.

**Resolution**: The analytics API now supports querying the `pages` table directly:

- **New `table` parameter**: Analytics queries accept `table=pages` to query per-page data
- **New `page_path` dimension**: Maps to `path` column in pages table
- **New page-specific metrics**: `page_duration`, `page_count`, `page_scroll`, `exit_rate`, etc.
- **Additional dimensions**: `page_number`, `is_landing_page`, `is_exit_page`, `page_entry_type`

**Example**: To get average duration by page path:
```typescript
{
  table: 'pages',
  metrics: ['page_duration'],
  dimensions: ['page_path'],
  dateRange: { start: '...', end: '...' }
}
```

---

### ✅ RESOLVED: Issue #2 - Metric Now Uses Median at Both Levels

**Location**: `api/src/analytics/constants/metrics.ts:73-78`, `api/src/database/schemas.ts:327`

**Previous Problem**: The `avg_page_duration` metric computed "average of session-level averages", which was sensitive to outliers and had weighting bias.

**Resolution**: Changed to median at both levels:

1. **Session MV** now computes `medianIf(page_duration)` per session (stored as `median_page_duration`)
2. **Analytics metric** now computes `median(median_page_duration)` across sessions

**Current Implementation**:
```typescript
// Sessions MV (schemas.ts:327)
medianIf(e.page_duration, e.page_duration > 0) as median_page_duration

// Analytics metric (metrics.ts:73-78)
median_page_duration: {
  sql: 'round(median(median_page_duration), 1)',
  description: 'Median time on page (seconds)',
}
```

**Benefits**:
- Robust to outliers at both session and aggregate levels
- "Median of medians" is semantically clear
- Aligns with `median_duration` (TimeScore) design philosophy

**Two options for per-page analysis**:
- `median_page_duration` (sessions table) - Session-weighted, each session counts once
- `page_duration` (pages table) - Page-weighted, each page view counts once

---

### MEDIUM: Issue #3 - Landing Page Duration Data Loss for Bounces

**Location**: `sdk/src/sdk.ts:205, 340-350`

**Problem**: For single-page sessions (bounces), the landing page duration is **only captured if the unload ping fires successfully**.

**SDK Behavior**:
1. Initial `screen_view` sent **without** `page_duration` (line 205)
2. Duration only sent in `flushOnce()` via `ping` event (lines 340-350)

**Risk Scenarios**:
- Browser prevents beacon/fetch on aggressive tab close
- Network failure during unload
- iOS Safari aggressive page termination
- Browser extensions blocking tracking

**Impact**: Bounce sessions may have `median_page_duration = 0` even if the user spent significant time on the page.

**Note**: This is a known limitation of web analytics. The SDK uses `sendBeacon` API which has good browser support for unload events. The risk is acceptable given the tradeoffs.

---

### LOW: Issue #4 - `pageviews` Count Doesn't Match Duration Records

**Location**: `api/src/analytics/constants/metrics.ts:61-66`, `api/src/database/schemas.ts:424-447`

**Problem**: The `pageviews` metric counts all `screen_view` events, but the `pages` table only stores events with `page_duration > 0`.

**Comparison**:
| Metric Source | What It Counts |
|---------------|----------------|
| `pageviews` (sessions) | All `screen_view` events (including initial without duration) |
| `page_count` (pages) | Only events with `page_duration > 0` |

For a 3-page session:
- `pageviews` = 3 (all screen_views)
- `page_count` = 3 (if unload ping fires) or 2 (if unload fails)

**Note**: This is expected behavior. Use `pageviews` for total page impressions, `page_count` for pages with measured duration.

---

### LOW: Issue #5 - Pages Table Has Imprecise Timestamps

**Location**: `api/src/database/schemas.ts:435-436`

**Problem**: Both `entered_at` and `exited_at` are set to the same value:

```sql
e.updated_at as entered_at,
e.updated_at as exited_at,
```

**Semantic Issue**:
- For navigation events, `updated_at` is when the user **left** the page (exited)
- The actual `entered_at` should be `exited_at - duration`

**Impact**: Cannot calculate accurate page enter times; makes the `pages` table less useful for timeline analysis.

**Note**: Could be fixed with: `e.updated_at - INTERVAL e.page_duration SECOND as entered_at`

---

### LOW: Issue #6 - `page_number` is Always 1

**Location**: `api/src/database/schemas.ts:439`

```sql
1 as page_number,  // Always hardcoded to 1
```

**Impact**: Cannot determine page sequence within sessions. Loses the ability to answer "What's the average duration on the 2nd page of a session?"

**Note**: Computing actual page sequence requires session-level window functions which are complex in materialized views. The `page_number` dimension exists but always returns 1.

---

### ✅ NOT AN ISSUE: Issue #7 - Heartbeat Pings Correctly Excluded from median_page_duration

**Location**: `sdk/src/sdk.ts:541-551`, `api/src/database/schemas.ts:327`

**Observation**: Regular heartbeat pings include `page_active_time` in the `properties` map, but this isn't used by the materialized view:

```sql
medianIf(e.page_duration, e.page_duration > 0) as median_page_duration
```

Only the `page_duration` field (from navigation/unload events) contributes.

**Verdict**: This is **correct design**. Heartbeat pings represent intermediate states, not completed page views. Including them would cause over-counting.

---

### ✅ VERIFIED: Issue #8 - SDK Page Time Tracking is Accurate

**Location**: `sdk/src/sdk.ts:556-596`

The SDK's page duration tracking is **correctly implemented**:

1. **On hide/blur**: `stopHeartbeat(true)` accumulates page time to `pageActiveMs` (line 565)
2. **On resume**: `resumeHeartbeat()` sets new `pageStartTime` (line 458)
3. **On navigation**: `resetPageActiveTime()` correctly resets both counters (lines 679-683)

The calculation `getPageActiveMs()` properly combines accumulated + current active time (lines 590-596).

---

## Session Type Analysis

### Multi-Page Session (Working Correctly)

```
Page A → Page B → Page C → Exit

Events:
1. screen_view (path=/A, page_duration=0)           # Landing, no duration
2. screen_view (path=/B, page_duration=30, previous_path=/A)  # A's duration
3. screen_view (path=/C, page_duration=45, previous_path=/B)  # B's duration
4. ping (path=/C, page_duration=20)                 # C's duration (unload)

Sessions MV calculates:
- pageview_count = 3 (screen_views)
- median_page_duration = median(30, 45, 20) = 30s ✓
```

### Single-Page Session (Bounce - At Risk)

```
Page A → Exit (tab close)

Events:
1. screen_view (path=/A, page_duration=0)           # Landing, no duration
2. ping (path=/A, page_duration=60)                 # IF unload fires ✓

If unload fails:
- pageview_count = 1
- median_page_duration = 0  ✗ (data loss)
```

---

## Recommendations

### ✅ COMPLETED: Priority 1 - Per-Page Analytics Capability

The analytics API now supports:
- `table=pages` parameter for per-page queries
- `page_path` dimension for grouping by path
- `page_duration`, `page_count`, `page_scroll` metrics

### ✅ RESOLVED: Priority 2 - Metric Semantics

Changed to median at both levels:
- Session MV: `medianIf(page_duration)` per session → `median_page_duration`
- Analytics metric: `median(median_page_duration)` across sessions

Now fully robust to outliers with clear "median of medians" semantics.

### OPTIONAL: Priority 3 - Improve Unload Reliability

Current implementation uses `sendBeacon` which has good browser support. Further improvements could include:
- Periodic persistence of accumulated page duration
- Multiple beacon strategies (sendBeacon → fetch keepalive fallback)

### OPTIONAL: Priority 4 - Fix Pages Table Design

Low-priority improvements:
- Calculate proper `entered_at`: `e.updated_at - INTERVAL e.page_duration SECOND`
- Compute actual `page_number` (requires complex window functions in MV)

---

## What Was Fixed Since Original Analysis

### v3 Implementation Fixes

| Original Issue | Status | Implementation |
|----------------|--------|----------------|
| Page duration lost on navigation | ✅ Fixed | `sdk.ts:362-391` captures duration BEFORE reset |
| Unload ping missing page_duration | ✅ Fixed | `sdk.ts:340-350` includes page_duration in flushOnce() |
| No pageview_count | ✅ Fixed | `schemas.ts:326` adds countIf to MV |
| No page_duration column | ✅ Fixed | `schemas.ts:191` adds column |
| No pages table | ✅ Fixed | `schemas.ts:389-447` adds table + MV |

### Subsequent Fixes (v3 Updates)

| Issue | Status | Implementation |
|-------|--------|----------------|
| Cannot query per-page analytics | ✅ Fixed | `tables.ts`, `dimensions.ts`, `query-builder.ts` - pages table support |
| No page_path dimension | ✅ Fixed | `dimensions.ts:126-132` adds page_path dimension |
| No per-page metrics | ✅ Fixed | `metrics.ts:80-122` adds page_duration, page_count, etc. |
| avg_page_duration outlier sensitivity | ✅ Fixed | `schemas.ts:327` uses medianIf, `metrics.ts:73-78` uses median |

---

## Conclusion

**The page duration tracking system is now fully functional**:

1. ✅ **SDK tracking**: Accurate page duration calculation with visibility state handling
2. ✅ **Data storage**: Events → Sessions MV and Pages MV correctly aggregate data
3. ✅ **Analytics API**: Both sessions and pages tables queryable with appropriate metrics/dimensions

**Remaining design debt** (low priority):
- Pages table timestamps are both set to exit time (entered_at should be calculated)
- page_number is always 1 (complex to fix in MV)
- Bounce sessions may lose duration data if unload fails (inherent web limitation)

The original concern about "data that cannot be queried in a useful way" has been **fully addressed** - per-page duration is now accessible via `table=pages` queries.

---

## Files Analyzed

| File | Purpose |
|------|---------|
| `sdk/src/sdk.ts` | SDK page tracking logic |
| `sdk/src/types.ts` | SDK type definitions |
| `api/src/database/schemas.ts` | ClickHouse table schemas and MVs |
| `api/src/analytics/constants/metrics.ts` | Analytics metric definitions |
| `api/src/analytics/constants/dimensions.ts` | Analytics dimension definitions |
| `api/src/analytics/constants/tables.ts` | Analytics table configuration |
| `api/src/analytics/lib/query-builder.ts` | SQL query generation |
| `api/src/events/events.service.ts` | Event processing service |
| `api/src/events/dto/track-event.dto.ts` | Event DTO definitions |
