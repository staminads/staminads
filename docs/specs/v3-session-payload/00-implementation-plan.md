# V3 Session Payload Implementation Plan

**Version**: 3.0.0
**Status**: Planning
**Created**: 2026-01-08
**Last Updated**: 2026-01-08

## Overview

This document outlines the implementation plan for the V3 session payload architecture. The SDK builds a cumulative `actions[]` array containing all trackable items (pageviews, goals, future types), which the server deserializes into flat event rows.

**Key design decisions**:

- Single `actions[]` array holds all action types (discriminated union)
- Goal completion triggers immediate payload send (preserves timing)
- Server deserializes actions into flat events (preserves query performance)
- Cumulative payloads with server-side deduplication
- use v3 migration if needed for schemas changes
- dont support legacy clients after rollout

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  SDK                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  SessionState {                                                             │
│    actions: [                          // Cumulative array                  │
│      { type: 'pageview', path, page_number, duration, scroll, ... },       │
│      { type: 'goal', name, value, page_number, timestamp, ... },           │
│    ],                                                                       │
│    current_page: { path, page_number, entered_at, scroll }                 │
│  }                                                                          │
│                                                                             │
│  Send triggers:                                                             │
│    • Initial pageview → immediate                                          │
│    • Navigation → debounced                                                │
│    • Goal completion → IMMEDIATE (sync point)                              │
│    • Periodic (30-60s) → scheduled                                         │
│    • Unload → sendBeacon                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         POST /api/track                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Single handler:                                                            │
│    • Validate SessionPayload                                               │
│    • Deserialize actions[] by type → flat event rows                       │
│    • Apply deduplication tokens                                            │
│    • Return checkpoint for long sessions                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Events Table                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  + page_number UInt16          (accurate sequence from SDK)                 │
│  + _version UInt64             (conflict resolution)                        │
│  + goal_name String            (goal tracking)                              │
│  + goal_value Float32          (goal value)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
┌───────────────────────────────┐    ┌───────────────────────────────────────┐
│   Sessions MV                 │    │   Pages MV                            │
│   (minor updates)             │    │   (use page_number, argMax _version)  │
└───────────────────────────────┘    └───────────────────────────────────────┘
```

## Action Types

```typescript
type Action = PageviewAction | GoalAction
// Future: | ClickAction | CustomAction | VideoAction

interface PageviewAction {
  type: 'pageview'
  path: string
  page_number: number
  duration: number
  scroll: number
  entered_at: number
  exited_at: number
}

interface GoalAction {
  type: 'goal'
  name: string
  value?: number
  path: string
  page_number: number
  timestamp: number
  properties?: Record<string, string>
}
```

## Implementation Phases

| Phase | Name               | Description                             | Dependencies |
| ----- | ------------------ | --------------------------------------- | ------------ |
| 1     | Database Schema    | Add columns, update indexes             | None         |
| 2     | DTOs & Validation  | Define Action types, SessionPayload     | Phase 1      |
| 3     | Server Handler     | Deserialization + deduplication         | Phase 2      |
| 4     | Materialized Views | Update MVs for new columns              | Phase 3      |
| 5     | SDK                | Session state, actions[], send triggers | Phase 4      |
| 6     | Testing            | E2E tests, load tests                   | Phase 5      |

---

## Phase 1: Database Schema

**Goal**: Prepare ClickHouse schema for new payload format.

### Tasks

1.1. Add new columns to events table

- `page_number UInt16 DEFAULT 0`
- `_version UInt64 DEFAULT 0`
- `goal_name String DEFAULT ''`
- `goal_value Float32 DEFAULT 0`

1.2. Evaluate ORDER BY changes

- Current: `ORDER BY (session_id, created_at)`
- Consider: `ORDER BY (session_id, page_number, created_at)`

1.3. Create migration script

- Idempotent ALTER TABLE statements
- New columns have defaults for safety

1.4. Update pages table schema

- Add `page_number` column if not present

### Deliverables

- `01-database-schema.md` - Detailed schema changes
- Migration SQL script

---

## Phase 2: DTOs & Validation

**Goal**: Define TypeScript interfaces and validation for action types and session payload.

### Tasks

2.1. Define Action type discriminated union

- `PageviewAction` interface
- `GoalAction` interface
- Future-proof for `ClickAction`, `CustomAction`, etc.

2.2. Define `SessionPayload` DTO

- Session identifiers and attributes
- `actions: Action[]` array
- `current_page` optional object
- `checkpoint` for long sessions

2.3. Add validation decorators

- class-validator decorators
- Action type validation (discriminated union)
- Timestamp bounds checking
- Array size limits (`MAX_ACTIONS`)

### Deliverables

- `02-dtos-validation.md` - DTO specifications
- TypeScript interfaces and validators

---

## Phase 3: Server Handler

**Goal**: Transform session payload actions into flat event rows with deduplication.

### Tasks

3.1. Implement `SessionPayloadHandler`

- Extract session attributes
- Iterate `actions[]` array
- Switch on `action.type` to deserialize

3.2. Implement action deserializers

- `deserializePageview()` → screen_view event
- `deserializeGoal()` → goal event
- Extensible pattern for future action types

3.3. Handle `current_page`

- Skip until completed (don't store partial pageviews)

3.4. Implement checkpoint logic

- Skip actions at/before checkpoint
- Return new checkpoint in response (for long sessions)

3.5. Add server timestamp (`_version`)

- Set on all deserialized events
- Used for conflict resolution

3.6. Implement insert deduplication

- Generate deterministic token from event IDs
- Configure ClickHouse `insert_deduplication`
- Event ID patterns:
  - Pageview: `{session_id}_pv_{page_number}`
  - Goal: `{session_id}_goal_{name}_{timestamp}`

3.7. Update buffer service

- Pass deduplication settings to insert
- Handle dedup errors gracefully

### Deliverables

- `03-server-handler.md` - Processing and deduplication logic
- Handler implementations

---

## Phase 4: Materialized Views

**Goal**: Update MVs to leverage new columns.

### Tasks

4.1. Update Pages MV

- Use `page_number` from events (now accurate)
- Add `argMax(_version)` for updatable fields
- Update GROUP BY clause

4.2. Review Sessions MV

- Update for new columns
- Consider goal count aggregation

4.3. Handle MV recreation

- Drop and recreate (fresh start)

### Deliverables

- `04-materialized-views.md` - MV update specifications
- MV recreation scripts

---

## Phase 5: SDK

**Goal**: Build SDK to send session payloads with `actions[]` array.

### Tasks

5.1. Implement `SessionState` class

- In-memory `actions[]` array
- Track `currentPage` state
- Handle session lifecycle

5.2. Implement action tracking

- `trackPageview(path)` - Finalizes previous page, starts new
- `trackGoal(name, value?, properties?)` - Adds goal, triggers immediate send
- Future: `trackClick()`, `trackCustom()`, etc.

5.3. Implement send triggers

- Initial pageview → immediate
- Navigation → debounced (100ms)
- **Goal completion → immediate** (critical for timing)
- Periodic (30-60s) → scheduled
- Unload → sendBeacon

5.4. Implement `sendBeacon()` for unload

- visibilitychange listener
- Finalize current page to actions[]

5.5. Implement checkpointing

- Track acknowledged checkpoint
- Filter actions[] to send only new items
- Handle checkpoint response

5.6. Add payload compression

- Gzip or similar
- Server must handle compressed payloads

5.7. Session storage persistence

- Persist to sessionStorage
- Recover on page reload

### Deliverables

- `05-sdk.md` - SDK implementation details
- SDK code updates

---

## Phase 6: Testing

**Goal**: Ensure reliability.

### Tasks

6.1. Unit tests

- DTO validation (action types)
- Deserialization logic (each action type)
- Deduplication logic

6.2. Integration tests

- End-to-end payload flow
- MV correctness

6.3. Load testing

- Payload size limits
- Dedup performance
- Buffer throughput

6.4. Documentation

- API docs
- SDK docs

### Deliverables

- `06-testing.md` - Test plan
- Test suites

---

## File Structure

```
docs/specs/v3-session-payload/
├── 00-implementation-plan.md      # This file
├── 01-database-schema.md          # Phase 1 details
├── 02-dtos-validation.md          # Phase 2 details
├── 03-server-handler.md           # Phase 3 details
├── 04-materialized-views.md       # Phase 4 details
├── 05-sdk.md                      # Phase 5 details
└── 06-testing.md                  # Phase 6 details
```

---

## Success Criteria

| Metric                    | Current          | Target                     |
| ------------------------- | ---------------- | -------------------------- |
| HTTP requests per session | 5-10+            | 2-4                        |
| Page sequencing accuracy  | 0% (hardcoded 1) | 100%                       |
| Goal timing precision     | Good             | Preserved (immediate send) |
| Query performance         | Fast             | Unchanged                  |
| Payload types             | Multiple         | Single (`actions[]`)       |
| Extensibility             | Add endpoint     | Add action type            |

---

## Risks & Mitigations

| Risk                               | Impact | Mitigation                                         |
| ---------------------------------- | ------ | -------------------------------------------------- |
| Data loss on final payload failure | Medium | sendBeacon(), goals trigger sync, periodic updates |
| Payload size for long sessions     | Low    | Checkpointing, compression, MAX_ACTIONS cap        |
| Clock skew from clients            | Low    | `_version` server timestamp, validation            |
| SDK state management bugs          | Medium | Comprehensive testing, sessionStorage backup       |
| Action type discrimination bugs    | Low    | Exhaustive switch/case, TypeScript guards          |

---

## Timeline Estimate

| Phase                       | Estimated Effort |
| --------------------------- | ---------------- |
| Phase 1: Database Schema    | 0.5 day          |
| Phase 2: DTOs & Validation  | 0.5 day          |
| Phase 3: Server Handler     | 1 day            |
| Phase 4: Materialized Views | 0.5 day          |
| Phase 5: SDK                | 2 days           |
| Phase 6: Testing            | 1 day            |
| **Total**                   | **~5.5 days**    |

---

## Key Design Decisions

### Why `actions[]` instead of separate arrays?

| Approach                                   | Pros                                       | Cons                                               |
| ------------------------------------------ | ------------------------------------------ | -------------------------------------------------- |
| Separate arrays (`pageviews[]`, `goals[]`) | Type-specific validation                   | Multiple arrays to manage, more complex checkpoint |
| **Single `actions[]`**                     | Single array, unified handling, extensible | Discriminated union complexity                     |

**Decision**: Single `actions[]` with discriminated union is more extensible and simpler to checkpoint.

### Why goals trigger immediate send?

- Goals are time-sensitive for conversion attribution
- Goal completion is a natural sync point
- Ensures pageview context is persisted with the goal
- Minimal overhead (goal events are rare, 1-3 per session)

### Why cumulative instead of delta?

| Approach                     | Pros                             | Cons                                       |
| ---------------------------- | -------------------------------- | ------------------------------------------ |
| Delta (only new actions)     | Smaller payloads                 | Complex SDK state, gap risk                |
| **Cumulative (all actions)** | Idempotent, no gaps, simpler SDK | Larger payloads (mitigated by compression) |

**Decision**: Cumulative with server-side dedup is more reliable and simpler.

---

## Next Steps

1. Review and approve this implementation plan
2. Create detailed spec for each phase:
   - Phase 1: Database Schema
   - Phase 2: DTOs & Validation
   - Phase 3: Server Handler
   - Phase 4: Materialized Views
   - Phase 5: SDK
   - Phase 6: Testing
3. Implement phase by phase

---

## Related Documents

- [Session Payload Architecture](../../session-payload-architecture.md) - High-level architecture
- [Data Flow Architecture](../../data-flow-architecture.md) - Current architecture
- [Page Tracking Analysis](../../../sdk/PAGE_TRACKING_ANALYSIS.md) - SDK analysis
