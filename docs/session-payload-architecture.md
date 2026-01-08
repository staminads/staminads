# Session Payload Architecture

**Status**: Proposal
**Date**: 2026-01-08
**Last Updated**: 2026-01-08

## Overview

This document describes a hybrid approach for SDK data collection: the SDK builds an enriched session payload with a cumulative `actions[]` array, which the server deserializes into flat event rows before storing in ClickHouse.

**Key design decisions**:
- All trackable items (pageviews, goals, future action types) are stored in a single `actions[]` array
- Goal completion triggers an immediate payload send (preserves timing precision)
- Server deserializes actions into flat event rows (preserves query performance)

## Current vs Proposed Flow

### Current (Event-Based)

```
SDK → Individual Events (screen_view, ping, goal) → /track
    → Events Table (5-10+ requests per session)
    → Materialized Views → Sessions + Pages Tables
```

**Limitations**:
- High request overhead (5-10+ HTTP requests per session)
- `page_number` cannot be accurately computed (currently hardcoded to 1)
- Page sequencing lost in materialized views

### Proposed (Hybrid)

```
┌─────────────────────────────────────────────────────────────────┐
│ SDK                                                             │
├─────────────────────────────────────────────────────────────────┤
│ SessionPayload {                                                │
│   actions: [                    // Cumulative array             │
│     { type: 'pageview', ... },                                 │
│     { type: 'pageview', ... },                                 │
│     { type: 'goal', ... },      // Goal triggers immediate send│
│   ],                                                            │
│   current_page: { ... }                                        │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ /track endpoint                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Deserialize actions[] → Flat event rows by type                │
│   • pageview → screen_view event                               │
│   • goal → goal event                                          │
│   • (future: click, custom, etc.)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ ClickHouse (existing architecture)                              │
├─────────────────────────────────────────────────────────────────┤
│ Events Table → Sessions MV → Sessions Table                     │
│             → Pages MV → Pages Table                            │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits**:
- Reduced HTTP requests (5-10+ → 2-4 per session)
- Accurate page sequencing (SDK knows page order)
- Goals trigger immediate send (preserves conversion attribution timing)
- Single payload type (simpler server, one DTO)
- Extensible for future action types
- Existing query performance preserved (flat tables, proper indexes)

## Payload Structure

### Session Payload

```typescript
interface SessionPayload {
  // Identifiers
  session_id: string;
  workspace_id: string;

  // Session-level attributes (from first pageview)
  referrer?: string;
  referrer_domain?: string;
  landing_page?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;

  // Device info
  device?: string;
  browser?: string;
  os?: string;
  screen_width?: number;
  screen_height?: number;
  language?: string;
  timezone?: string;

  // Cumulative actions array (pageviews, goals, future types)
  actions: Action[];

  // Current page (still being viewed, not yet in actions[])
  current_page?: {
    path: string;
    page_number: number;
    entered_at: number;
    scroll: number;
  };

  // Checkpoint for long sessions
  checkpoint?: number;
}
```

### Action Types (Discriminated Union)

```typescript
type Action = PageviewAction | GoalAction;
// Future: | ClickAction | CustomAction | FormAction | VideoAction

interface PageviewAction {
  type: 'pageview';
  path: string;
  page_number: number;         // 1-indexed sequence
  duration: number;            // Seconds on page
  scroll: number;              // Max scroll depth (0-100)
  entered_at: number;          // Unix ms timestamp
  exited_at: number;           // Unix ms timestamp
}

interface GoalAction {
  type: 'goal';
  name: string;
  value?: number;
  path: string;                // Page where goal occurred
  page_number: number;         // Page number where goal occurred
  timestamp: number;           // Unix ms timestamp
  properties?: Record<string, string>;
}

// Future action types (examples)
interface ClickAction {
  type: 'click';
  path: string;
  page_number: number;
  element: string;             // CSS selector or element ID
  timestamp: number;
}

interface CustomAction {
  type: 'custom';
  name: string;
  path: string;
  page_number: number;
  timestamp: number;
  properties?: Record<string, string>;
}
```

## SDK Behavior

### Send Triggers

| Trigger | Timing | Rationale |
|---------|--------|-----------|
| Initial pageview | Immediate | Establish session |
| Navigation (SPA) | Debounced (next cycle) | Batch pageviews |
| **Goal completion** | **Immediate** | Time-sensitive, triggers full sync |
| Periodic (30-60s) | Scheduled | Heartbeat, scroll updates |
| Unload/visibility hidden | sendBeacon | Final data |

### SDK Implementation

```typescript
class SessionState {
  private sessionId: string;
  private workspaceId: string;
  private actions: Action[] = [];
  private currentPage: CurrentPage | null = null;
  private checkpoint: number = 0;
  private sendScheduled: boolean = false;

  // Track a pageview (called on navigation)
  trackPageview(path: string) {
    // Finalize previous page
    if (this.currentPage) {
      this.actions.push({
        type: 'pageview',
        path: this.currentPage.path,
        page_number: this.currentPage.page_number,
        duration: this.calculateDuration(),
        scroll: this.currentPage.scroll,
        entered_at: this.currentPage.entered_at,
        exited_at: Date.now(),
      });
    }

    // Start new page
    this.currentPage = {
      path,
      page_number: (this.currentPage?.page_number ?? 0) + 1,
      entered_at: Date.now(),
      scroll: 0,
    };

    this.scheduleSend();
  }

  // Track a goal (triggers immediate send)
  trackGoal(name: string, value?: number, properties?: Record<string, string>) {
    this.actions.push({
      type: 'goal',
      name,
      value,
      path: this.currentPage?.path ?? '',
      page_number: this.currentPage?.page_number ?? 0,
      timestamp: Date.now(),
      properties,
    });

    // Goal triggers immediate send
    this.sendNow();
  }

  // Schedule a debounced send
  private scheduleSend() {
    if (this.sendScheduled) return;
    this.sendScheduled = true;
    setTimeout(() => {
      this.sendNow();
      this.sendScheduled = false;
    }, 100);
  }

  // Send payload immediately
  private sendNow() {
    const payload = this.buildPayload();
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(res => res.json())
      .then(data => {
        if (data.checkpoint) {
          this.handleCheckpoint(data.checkpoint);
        }
      });
  }

  // Build the session payload
  private buildPayload(): SessionPayload {
    return {
      session_id: this.sessionId,
      workspace_id: this.workspaceId,
      actions: this.getActionsForSend(),
      current_page: this.currentPage,
      checkpoint: this.checkpoint || undefined,
      // ... session attributes
    };
  }

  // Get actions to send (respecting checkpoint)
  private getActionsForSend(): Action[] {
    if (!this.checkpoint) return this.actions;

    return this.actions.filter(a => {
      if (a.type === 'pageview') {
        return a.page_number > this.checkpoint;
      }
      // Goals: filter by timestamp or always include
      return true;
    });
  }

  // Handle checkpoint from server response
  private handleCheckpoint(checkpoint: number) {
    this.checkpoint = checkpoint;
    // Optionally prune old actions from memory
    if (this.actions.length > 100) {
      this.actions = this.actions.filter(a =>
        a.type !== 'pageview' || a.page_number > checkpoint
      );
    }
  }

  // Handle page unload
  onUnload() {
    // Finalize current page
    if (this.currentPage) {
      this.actions.push({
        type: 'pageview',
        path: this.currentPage.path,
        page_number: this.currentPage.page_number,
        duration: this.calculateDuration(),
        scroll: this.currentPage.scroll,
        entered_at: this.currentPage.entered_at,
        exited_at: Date.now(),
      });
    }

    // Use sendBeacon for reliable delivery
    const payload = this.buildPayload();
    navigator.sendBeacon('/api/track', JSON.stringify(payload));
  }
}
```

### Cumulative Payloads

The SDK sends the complete `actions[]` array on each update. The server handles deduplication.

**Benefits**:
- Simpler SDK implementation (no tracking of acknowledgments)
- Idempotent (safe to retry failed requests)
- No data gaps if a request fails silently
- Goals always arrive with full pageview context

**Recommendation**: Enable gzip compression on payloads. Repetitive JSON structures typically achieve 80-90% size reduction.

### Long Sessions (Checkpointing)

For sessions exceeding `MAX_ACTIONS` (default: 100), implement checkpointing:

```typescript
const MAX_ACTIONS = 100;

// Server response includes checkpoint
interface SessionTrackResponse {
  success: boolean;
  checkpoint?: number;  // Highest acknowledged page_number
}
```

The SDK can prune acknowledged pageviews from memory while retaining recent ones.

### Unload Handling

**Critical**: Use `sendBeacon()` for the final payload to maximize delivery success:

```typescript
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    sessionState.onUnload();
  }
});
```

## Server Deserialization

### Single Handler for All Actions

```typescript
async trackSession(payload: SessionPayload, clientIp: string) {
  const events: EventEntity[] = [];
  const sessionAttrs = this.extractSessionAttrs(payload);
  const serverTimestamp = Date.now();
  const geo = await this.geoService.lookup(clientIp);

  // Deserialize all actions by type
  for (const action of payload.actions) {
    // Skip if before checkpoint
    if (this.isBeforeCheckpoint(action, payload.checkpoint)) {
      continue;
    }

    const baseEvent = {
      session_id: payload.session_id,
      workspace_id: payload.workspace_id,
      _version: serverTimestamp,
      ...sessionAttrs,
      ...geo,
    };

    switch (action.type) {
      case 'pageview':
        events.push(this.deserializePageview(action, baseEvent));
        break;
      case 'goal':
        events.push(this.deserializeGoal(action, baseEvent));
        break;
      // Future: case 'click', case 'custom', etc.
    }
  }

  // Insert with deduplication
  await this.insertWithDedup(payload.workspace_id, events);

  // Calculate checkpoint (highest page_number)
  const maxPageNumber = Math.max(
    0,
    ...payload.actions
      .filter((a): a is PageviewAction => a.type === 'pageview')
      .map(a => a.page_number)
  );

  return {
    success: true,
    checkpoint: maxPageNumber > 50 ? maxPageNumber : undefined,
  };
}

private deserializePageview(action: PageviewAction, base: Partial<EventEntity>): EventEntity {
  return {
    ...base,
    id: `${base.session_id}_pv_${action.page_number}`,
    name: 'screen_view',
    path: action.path,
    page_number: action.page_number,
    page_duration: action.duration,
    max_scroll: action.scroll,
    created_at: new Date(action.exited_at),
  };
}

private deserializeGoal(action: GoalAction, base: Partial<EventEntity>): EventEntity {
  return {
    ...base,
    id: `${base.session_id}_goal_${action.name}_${action.timestamp}`,
    name: 'goal',
    path: action.path,
    page_number: action.page_number,
    goal_name: action.name,
    goal_value: action.value ?? 0,
    created_at: new Date(action.timestamp),
    properties: action.properties ?? {},
  };
}
```

## Deduplication Strategy

### Insert Deduplication Tokens

**Recommended approach**: Use ClickHouse's insert deduplication with deterministic tokens.

```typescript
async insertWithDedup(workspaceId: string, events: EventEntity[]) {
  if (events.length === 0) return;

  // Generate deterministic dedup token from event IDs
  const dedupToken = events.map(e => e.id).sort().join('|');

  await this.clickhouse.insert({
    table: `staminads_ws_${workspaceId}.events`,
    values: events,
    settings: {
      insert_deduplication: 1,
      insert_dedup_token: dedupToken,
    },
  });
}
```

### Event ID Patterns

| Action Type | ID Pattern | Example |
|-------------|------------|---------|
| Pageview | `{session_id}_pv_{page_number}` | `abc123_pv_3` |
| Goal | `{session_id}_goal_{name}_{timestamp}` | `abc123_goal_signup_1704758400000` |
| Click | `{session_id}_click_{timestamp}` | `abc123_click_1704758400000` |
| Custom | `{session_id}_custom_{name}_{timestamp}` | `abc123_custom_video_play_1704758400000` |

### Conflict Resolution with `_version`

For actions that may be updated (e.g., scroll depth updates on same pageview):

```sql
SELECT
  session_id,
  page_number,
  argMax(page_duration, _version) as page_duration,
  argMax(max_scroll, _version) as max_scroll
FROM events
WHERE name = 'screen_view'
GROUP BY session_id, page_number
```

## Schema Changes

### Events Table

```sql
-- Add page_number column
ALTER TABLE events ADD COLUMN page_number UInt16 DEFAULT 0;

-- Add version column for conflict resolution
ALTER TABLE events ADD COLUMN _version UInt64 DEFAULT 0;

-- Add goal columns
ALTER TABLE events ADD COLUMN goal_name String DEFAULT '';
ALTER TABLE events ADD COLUMN goal_value Float32 DEFAULT 0;

-- Future: Add columns for other action types as needed
-- ALTER TABLE events ADD COLUMN element String DEFAULT '';  -- for clicks
```

### Primary Key Consideration

For efficient deduplication queries:

```sql
ORDER BY (session_id, page_number, created_at)
```

### Pages Materialized View

```sql
CREATE MATERIALIZED VIEW pages_mv TO pages AS
SELECT
  e.session_id,
  e.path,
  e.page_number,
  argMax(e.page_duration, e._version) as duration,
  argMax(e.max_scroll, e._version) as scroll,
  min(e.created_at) as entered_at,
  max(e.created_at) as exited_at,
  -- ... other fields
FROM events e
WHERE e.name = 'screen_view' AND e.page_duration > 0
GROUP BY e.session_id, e.path, e.page_number
```

## Risks and Mitigations

### 1. Data Loss Window

**Risk**: Batching more data per request means more data lost if final payload fails.

**Mitigations**:
- Use `sendBeacon()` for final payload (high delivery success rate)
- Goals trigger immediate send (ensures sync point)
- Periodic updates (30-60s) ensure most data is persisted
- Previous updates are preserved even if final fails

### 2. Payload Size Growth

**Risk**: Cumulative payloads grow linearly with session length.

**Mitigations**:
- Gzip compression (80-90% reduction)
- Checkpointing for sessions > 100 actions
- Cap maximum payload size

### 3. Client Clock Skew

**Risk**: Timestamps come from client, may be inaccurate.

**Mitigations**:
- Server adds `_version` timestamp for ordering
- Validate client timestamps are within reasonable bounds
- Use server timestamp for `created_at` if client timestamp is invalid

### 4. SDK State Management

**Risk**: SDK maintains stateful session history, increasing complexity.

**Mitigations**:
- Clear state on session timeout (30 min inactivity)
- Persist to sessionStorage for tab recovery
- Comprehensive testing for edge cases

## ClickHouse Considerations

### Why Flat Tables Over Nested Arrays

- Filtering inside arrays is slower than indexed columns
- Array columns don't benefit from primary key ordering
- Aggregations across array elements require `arrayJoin` (expensive)
- Existing MVs and queries continue to work unchanged

### ReplacingMergeTree Behavior

ReplacingMergeTree deduplicates at **merge time**, not insert time. Options:

1. **Insert deduplication tokens** (recommended) - Atomic dedup at insert
2. **FINAL keyword** - Expensive, forces merge on read
3. **argMax aggregation** - Handle in query with `_version` column

### Partitioning

```sql
PARTITION BY toYYYYMMDD(created_at)
TTL created_at + INTERVAL 7 DAY
```

## Extensibility

The `actions[]` array is designed to accommodate future action types:

```typescript
// Adding a new action type:
interface VideoAction {
  type: 'video';
  path: string;
  page_number: number;
  video_id: string;
  event: 'play' | 'pause' | 'complete';
  position: number;        // Seconds into video
  timestamp: number;
}

// Update the union:
type Action = PageviewAction | GoalAction | ClickAction | CustomAction | VideoAction;
```

Server deserialization just needs a new `case` in the switch statement.

## Comparison

| Aspect | Pure Events | Pure Embedded | Hybrid (actions[]) |
|--------|-------------|---------------|---------------------|
| Requests/session | 5-10+ | 1-3 | 2-4 |
| Page sequencing | Broken | Accurate | Accurate |
| Query performance | Fast | Slow (arrayJoin) | Fast |
| Partial data safety | Best | Worst | Good |
| Schema evolution | Easy | Hard | Easy |
| Filter backfill | Easy | Complex | Easy |
| Existing MVs | Unchanged | Redesign | Minor update |
| Goal timing | Best | Worst | Best (immediate trigger) |
| Payload types | Multiple | Single | Single |
| Extensibility | Add endpoint | Modify array schema | Add action type |

## API

### Request

```http
POST /api/track
Content-Type: application/json

{
  "session_id": "abc123",
  "workspace_id": "ws_456",
  "actions": [
    {
      "type": "pageview",
      "path": "/home",
      "page_number": 1,
      "duration": 45,
      "scroll": 80,
      "entered_at": 1704758400000,
      "exited_at": 1704758445000
    },
    {
      "type": "goal",
      "name": "signup",
      "value": 99.99,
      "path": "/pricing",
      "page_number": 2,
      "timestamp": 1704758500000
    }
  ],
  "current_page": {
    "path": "/pricing",
    "page_number": 2,
    "entered_at": 1704758445000,
    "scroll": 50
  }
}
```

### Response

```json
{
  "success": true,
  "checkpoint": 50
}
```

## Migration Path

### Phase 1: Database Schema
1. Add `page_number`, `_version`, `goal_name`, `goal_value` columns
2. Update events table schema

### Phase 2: Server Implementation
1. Implement session payload handler with action deserialization
2. Implement insert deduplication
3. Add validation for SessionPayload and Action types

### Phase 3: Materialized Views
1. Update MVs to use `page_number` column
2. Add `argMax(_version)` handling

### Phase 4: SDK
1. Implement session state manager with `actions[]` array
2. Implement action types (pageview, goal)
3. Goal completion triggers immediate send
4. Add `sendBeacon()` for unload
5. Implement checkpointing
6. Enable compression

## Related Documents

- [Data Flow Architecture](./data-flow-architecture.md) - Current architecture details
- [Page Tracking Analysis](../sdk/PAGE_TRACKING_ANALYSIS.md) - SDK tracking implementation
- [Implementation Plan](./specs/v3-session-payload/00-implementation-plan.md) - Detailed implementation phases
