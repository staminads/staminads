# V3 Session Payload Implementation Report

**Date**: 2026-01-08
**Status**: Phase 5 SDK Integration Pending

## Executive Summary

The V3 session payload implementation is 90% complete. All server-side components (Phases 1-4) and Phase 6 (Testing) are done. The SDK has foundational classes (SessionState, Sender methods) but the final integration into `sdk.ts` is pending.

## Implementation Status by Phase

### Phase 1: Database Schema ✅ Complete

| Task | Status | Files |
|------|--------|-------|
| Add new columns to events table | ✅ | `api/src/database/schemas.ts` |
| Add page_number, _version, goal_name, goal_value | ✅ | `api/src/database/schemas.ts` |
| Create migration script | ✅ | `api/src/migrations/versions/v3.migration.ts` |
| Update pages table schema | ✅ | `api/src/database/schemas.ts` |

### Phase 2: DTOs & Validation ✅ Complete

| Task | Status | Files |
|------|--------|-------|
| Define Action discriminated union | ✅ | `api/src/events/dto/session-payload.dto.ts` |
| Define PageviewAction interface | ✅ | `api/src/events/dto/session-payload.dto.ts` |
| Define GoalAction interface | ✅ | `api/src/events/dto/session-payload.dto.ts` |
| Define SessionPayload DTO | ✅ | `api/src/events/dto/session-payload.dto.ts` |
| Add validation decorators | ✅ | `api/src/events/dto/session-payload.dto.ts` |
| MAX_ACTIONS limit (1000) | ✅ | `api/src/events/dto/session-payload.dto.ts` |
| Unit tests | ✅ | `api/src/events/dto/session-payload.dto.spec.ts` |

### Phase 3: Server Handler ✅ Complete

| Task | Status | Files |
|------|--------|-------|
| Implement SessionPayloadHandler | ✅ | `api/src/events/session-payload.handler.ts` |
| Deserialize pageviews | ✅ | `api/src/events/session-payload.handler.ts` |
| Deserialize goals | ✅ | `api/src/events/session-payload.handler.ts` |
| Handle current_page | ✅ | Skipped (as specified) |
| Checkpoint logic | ✅ | `api/src/events/session-payload.handler.ts` |
| Server timestamp (_version) | ✅ | `api/src/events/session-payload.handler.ts` |
| Dedup token generation | ✅ | `api/src/events/session-payload.handler.ts` |
| Unit tests | ✅ | `api/src/events/session-payload.handler.spec.ts` |

### Phase 4: Materialized Views ✅ Complete

| Task | Status | Files |
|------|--------|-------|
| Update Pages MV | ✅ | `api/src/database/schemas.ts` |
| Use ReplacingMergeTree(_version) | ✅ | `api/src/database/schemas.ts` |
| ORDER BY (session_id, page_number) | ✅ | `api/src/database/schemas.ts` |
| Exclude goals from pages | ✅ | `api/src/database/schemas.ts` |
| Update Sessions MV | ✅ | `api/src/database/schemas.ts` |
| Goal count/value aggregation | ✅ | `api/src/database/schemas.ts` |

### Phase 5: SDK ⚠️ Partially Complete

| Task | Status | Files |
|------|--------|-------|
| **SessionState class** | ✅ | `sdk/src/core/session-state.ts` |
| Constructor with config | ✅ | `sdk/src/core/session-state.ts` |
| addPageview() | ✅ | `sdk/src/core/session-state.ts` |
| addGoal() with MAX_ACTIONS | ✅ | `sdk/src/core/session-state.ts` |
| updateScroll() | ✅ | `sdk/src/core/session-state.ts` |
| buildPayload() | ✅ | `sdk/src/core/session-state.ts` |
| applyCheckpoint() | ✅ | `sdk/src/core/session-state.ts` |
| markAttributesSent() | ✅ | `sdk/src/core/session-state.ts` |
| finalizeForUnload() | ✅ | `sdk/src/core/session-state.ts` |
| persist() / restore() | ✅ | `sdk/src/core/session-state.ts` |
| **Type definitions** | ✅ | `sdk/src/types/session-state.ts` |
| **Sender modifications** | ✅ | `sdk/src/transport/sender.ts` |
| sendSession() | ✅ | `sdk/src/transport/sender.ts` |
| sendSessionBeacon() | ✅ | `sdk/src/transport/sender.ts` |
| **SDK Integration** | ❌ | `sdk/src/sdk.ts` |
| Add sessionState property | ❌ | Pending |
| Initialize SessionState | ❌ | Pending |
| Modify trackPageView() | ❌ | Pending |
| Modify trackGoal() | ❌ | Pending |
| Modify onUnload() | ❌ | Pending |
| Modify heartbeat | ❌ | Pending |
| Remove DurationTracker | ❌ | Pending |
| **Integration tests** | ✅ | `sdk/tests/integration/session-state.integration.test.ts` |

### Phase 6: Testing ✅ Complete

| Task | Status | Files |
|------|--------|-------|
| Cross-phase DTO tests | ✅ | `api/src/events/dto/session-payload.dto.spec.ts` |
| Cross-phase handler tests | ✅ | `api/src/events/session-payload.handler.spec.ts` |
| E2E tests | ✅ | `api/test/session-payload.e2e-spec.ts` |
| Load tests (k6) | ✅ | `api/test/load/session-payload.load.js` |
| OpenAPI documentation | ✅ | `api/src/events/events.controller.ts` |

---

## What Remains (SDK Integration)

The following items need to be implemented per `05-sdk-implementation.md`:

### 1. Core SDK Changes (`sdk/src/sdk.ts`)

```
□ Add SessionState import and property
□ Update SDK_VERSION to '6.0.0'
□ Add sendDebounceTimeout property
□ Replace initializeAsync() - use SessionState instead of DurationTracker
□ Replace onNavigation() - finalize page, add new pageview, debounced send
□ Replace flushOnce() - finalize, beacon send
□ Replace sendPingEvent() - update scroll, periodic send
□ Add scheduleDebouncedSend() helper
□ Add sendPayload() helper
□ Add buildAttributes() helper
□ Update trackPageView() - use SessionState
□ Update trackGoal() - use SessionState with immediate send
□ Deprecate trackEvent()
□ Remove sendEvent() method
□ Remove onScrollMilestone() callback
□ Remove DurationTracker entirely
```

### 2. Type Changes (`sdk/src/types.ts`)

```
□ Remove EventName type
□ Remove TrackEventPayload interface
□ Remove QueuedPayload interface
□ Update SessionDebugInfo
```

### 3. Transport Changes (`sdk/src/transport/sender.ts`)

```
□ Remove legacy send() method
□ Remove sendWithBeacon() method
□ Remove queue-related code
□ Simplify class
```

### 4. File Cleanup

```
□ Delete sdk/src/core/duration.ts
□ Delete sdk/src/core/duration.test.ts
□ Update sdk/src/core/index.ts
```

---

## Verification Checklist

### Server-Side (All Passing ✅)

```bash
cd api && npm test
# 33 test suites, all passing

cd api && npm run lint
# No errors

cd api && npm run build
# Success
```

### SDK (Pending Integration)

```bash
cd sdk && npm test
# Currently 405 tests passing (before integration)
# After integration, update tests and verify
```

---

## Architecture Diagram

```
                    IMPLEMENTED                          PENDING
                    ───────────                          ───────

┌─────────────────────────────────────────────────────────────────────────────┐
│                                  SDK                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✅ SessionState class          │  ❌ sdk.ts integration                    │
│  ✅ sendSession() method        │  ❌ Remove DurationTracker                │
│  ✅ sendSessionBeacon()         │  ❌ Update trackPageView/trackGoal        │
│  ✅ Type definitions            │  ❌ Version bump to 6.0.0                 │
└─────────────────────────────────┴───────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    POST /api/track.session  ✅                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✅ SessionPayloadHandler                                                   │
│  ✅ DTO validation                                                          │
│  ✅ Checkpoint logic                                                        │
│  ✅ Deduplication tokens                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Events Table  ✅                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  + page_number UInt16                                                       │
│  + _version UInt64                                                          │
│  + goal_name String                                                         │
│  + goal_value Float32                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
┌───────────────────────────────┐    ┌───────────────────────────────────────┐
│   Sessions MV  ✅             │    │   Pages MV  ✅                        │
│   goal_count, goal_value      │    │   ReplacingMergeTree(_version)       │
└───────────────────────────────┘    └───────────────────────────────────────┘
```

---

## Files Summary

### Implemented Files

| Path | Purpose |
|------|---------|
| `api/src/events/dto/session-payload.dto.ts` | DTOs and validation |
| `api/src/events/dto/session-payload.dto.spec.ts` | DTO unit tests |
| `api/src/events/session-payload.handler.ts` | Server handler |
| `api/src/events/session-payload.handler.spec.ts` | Handler unit tests |
| `api/src/events/events.controller.ts` | Controller with OpenAPI |
| `api/src/database/schemas.ts` | Updated ClickHouse schemas |
| `api/src/migrations/versions/v3.migration.ts` | V3 migration |
| `api/src/migrations/versions/v3.migration.spec.ts` | Migration tests |
| `api/test/session-payload.e2e-spec.ts` | E2E tests |
| `api/test/load/session-payload.load.js` | k6 load tests |
| `sdk/src/core/session-state.ts` | SessionState class |
| `sdk/src/types/session-state.ts` | Session payload types |
| `sdk/src/transport/sender.ts` | Added sendSession methods |
| `sdk/tests/integration/session-state.integration.test.ts` | Integration tests |

### Pending Modifications

| Path | Changes Needed |
|------|----------------|
| `sdk/src/sdk.ts` | Major refactoring per 05-sdk-implementation.md |
| `sdk/src/types.ts` | Remove legacy types |
| `sdk/src/transport/sender.ts` | Remove legacy methods |
| `sdk/src/core/duration.ts` | DELETE |
| `sdk/src/core/duration.test.ts` | DELETE |

### Spec Documents

| Path | Purpose |
|------|---------|
| `docs/specs/v3-session-payload/00-implementation-plan.md` | Master plan |
| `docs/specs/v3-session-payload/01-database-schema.md` | Phase 1 spec |
| `docs/specs/v3-session-payload/02-dtos-validation.md` | Phase 2 spec |
| `docs/specs/v3-session-payload/03-server-handler.md` | Phase 3 spec |
| `docs/specs/v3-session-payload/04-materialized-views.md` | Phase 4 spec |
| `docs/specs/v3-session-payload/05-sdk.md` | Original Phase 5 spec |
| `docs/specs/v3-session-payload/05-sdk-implementation.md` | **NEW: Complete SDK refactoring spec** |
| `docs/specs/v3-session-payload/06-testing.md` | Phase 6 spec |

---

## Next Steps

1. **Implement SDK Integration** per `05-sdk-implementation.md`
2. Run SDK tests: `cd sdk && npm test`
3. Build SDK: `cd sdk && npm run build`
4. Verify bundle size
5. Manual browser testing

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK breaking change | High | Major version bump (6.0.0), clear documentation |
| Bundle size increase | Low | Net decrease expected (-4KB) |
| Test coverage gaps | Medium | 39 SessionState tests, update existing SDK tests |
| Browser compatibility | Low | Same APIs (fetch, sendBeacon, sessionStorage) |

---

## Conclusion

The V3 session payload implementation is nearly complete. The server-side is fully functional and tested. The SDK has the core classes ready but needs the final integration into `sdk.ts` to replace the legacy event-based tracking.

**Estimated remaining effort**: 0.5-1 day for SDK integration + testing.
