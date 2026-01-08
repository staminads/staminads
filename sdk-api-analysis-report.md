# SDK → API Data Handling Analysis Report

**Date**: 2026-01-08
**Analyzed**: SDK payload structure vs API endpoint handling

## Executive Summary

After thorough analysis of the SDK payload structure (`sdk/src/types/session-state.ts`) and API endpoint handling (`api/src/events/`), I identified **3 data handling issues** where SDK-sent data is not properly stored, plus 1 minor type issue.

---

## Verified Correct Behaviors

### `current_page` - Intentionally Ignored (NOT A BUG)

The `current_page` field represents a page the user is **currently viewing** (not yet finalized). This is intentionally ignored by the handler, as confirmed by the test at `session-payload.handler.spec.ts:344-362`:

```typescript
it('ignores current_page (not finalized)', async () => {
  // ...
  expect(events).toHaveLength(1); // Only the action, not current_page
});
```

**Rationale**: When the user leaves the page, the SDK finalizes it into a `PageviewAction` in the `actions[]` array with proper `duration`, `entered_at`, and `exited_at` values. The `current_page` is only useful for real-time "active users" features, which aren't implemented.

---

## Issue 1: Pageview `entered_at` / `exited_at` Timestamps Not Stored

**Severity**: 🔴 CRITICAL

**SDK sends** (`sdk/src/core/session-state.ts:248-256`):
```typescript
const pageview: PageviewAction = {
  type: 'pageview',
  path: this.currentPage.path,
  page_number: this.currentPage.page_number,
  duration,
  scroll: this.currentPage.scroll,
  entered_at: this.currentPage.entered_at,  // ← Actual timestamp
  exited_at: exitTime,                       // ← Actual timestamp
};
```

**API validates** (`api/src/events/dto/session-payload.dto.ts:48-55`):
```typescript
@IsNumber()
entered_at: number;

@IsNumber()
@IsGreaterThanOrEqual('entered_at', {...})
exited_at: number;
```

**API deserializes** (`api/src/events/session-payload.handler.ts:254-268`):
```typescript
private deserializePageview(...): TrackingEvent {
  return {
    ...baseEvent,
    dedup_token: `${sessionId}_pv_${action.page_number}`,
    name: 'screen_view',
    path: action.path,
    page_number: action.page_number,
    duration: action.duration,
    page_duration: action.duration,
    max_scroll: action.scroll,
    previous_path: previousPath,
    // ❌ action.entered_at NOT USED
    // ❌ action.exited_at NOT USED
  };
}
```

**Database schema** (`api/src/database/schemas.ts:180-250`):
- Events table has NO `entered_at` or `exited_at` columns

**Impact**:
- Precise page timing data is lost
- Pages MV calculates `entered_at` using approximation: `subtractSeconds(e.updated_at, intDiv(e.page_duration, 1000))`
- Cannot reconstruct exact user journey timelines

---

## Issue 2: Goal Action `timestamp` Not Stored

**Severity**: 🟠 HIGH

**SDK sends** (`sdk/src/core/session-state.ts:112-118`):
```typescript
const goal: GoalAction = {
  type: 'goal',
  name,
  path: this.currentPage?.path || '/',
  page_number: this.currentPage?.page_number || 1,
  timestamp: Date.now(),  // ← When goal was triggered
};
```

**API deserializes** (`api/src/events/session-payload.handler.ts:271-289`):
```typescript
private deserializeGoal(...): TrackingEvent {
  return {
    ...baseEvent,
    dedup_token: `${sessionId}_goal_${action.name}_${action.timestamp}`,  // Only used here
    name: 'goal',
    path: action.path,
    page_number: action.page_number,
    goal_name: action.name,
    goal_value: action.value ?? 0,
    properties: action.properties ?? {},
    // ❌ action.timestamp NOT stored as separate field
  };
}
```

**Database schema**:
- Events table has NO `goal_timestamp` column

**Impact**:
- Cannot determine exact time when conversions occurred
- Time-series goal analysis uses `received_at` (server time) instead of actual trigger time
- Clock skew between SDK and server can distort analytics

---

## Issue 3: Pages Table Uses Calculated vs Actual Timestamps

**Severity**: 🟡 MEDIUM (depends on Issue 1)

**Current implementation** (`api/src/database/schemas.ts:445-446`):
```sql
subtractSeconds(e.updated_at, intDiv(e.page_duration, 1000)) as entered_at,
e.updated_at as exited_at,
```

**Issue**:
- `entered_at` is back-calculated from `updated_at - duration`
- If Issue 1 were fixed, the MV could use actual SDK timestamps for better accuracy

---

## Issue 4: TypeScript Entity Types Mark Required Fields as Optional

**Severity**: 🟢 LOW

**TrackingEvent entity** (`api/src/events/entities/event.entity.ts:83-91`):
```typescript
// V3 Session Payload fields
dedup_token?: string;  // ❌ Always provided by handler
page_number?: number;  // ❌ Always provided by handler
_version?: number;     // ❌ Always provided by handler
goal_name?: string;    // ❌ Always provided (empty string for pageviews)
goal_value?: number;   // ❌ Always provided (0 for pageviews)
```

**Impact**:
- Minor - just type safety, runtime behavior is correct

---

## Field-by-Field Comparison Table

| SDK Field | API DTO | Handler Uses | Stored in DB | Status |
|-----------|---------|--------------|--------------|--------|
| `workspace_id` | ✅ Required | ✅ | ✅ events.workspace_id | ✅ OK |
| `session_id` | ✅ Required | ✅ | ✅ events.session_id | ✅ OK |
| `actions[]` | ✅ Required | ✅ | ✅ Processed | ✅ OK |
| `current_page` | ✅ Optional | ❌ Ignored | ❌ | ✅ OK (by design) |
| `checkpoint` | ✅ Optional | ✅ For delta | ❌ | ✅ OK (by design) |
| `attributes` | ✅ Optional | ✅ | ✅ All fields | ✅ OK |
| `created_at` | ✅ Required | ✅ | ✅ events.created_at | ✅ OK |
| `updated_at` | ✅ Required | ✅ | ✅ events.updated_at | ✅ OK |
| `sdk_version` | ✅ Required | ✅ | ✅ events.sdk_version | ✅ OK |
| **Pageview Action** |  |  |  |  |
| `type` | ✅ 'pageview' | ✅ | ✅ name='screen_view' | ✅ OK |
| `path` | ✅ Required | ✅ | ✅ events.path | ✅ OK |
| `page_number` | ✅ Required | ✅ | ✅ events.page_number | ✅ OK |
| `duration` | ✅ Required | ✅ | ✅ events.duration | ✅ OK |
| `scroll` | ✅ Required | ✅ | ✅ events.max_scroll | ✅ OK |
| `entered_at` | ✅ Required | ❌ | ❌ **Not stored** | 🔴 ISSUE 1 |
| `exited_at` | ✅ Required | ❌ | ❌ **Not stored** | 🔴 ISSUE 1 |
| **Goal Action** |  |  |  |  |
| `type` | ✅ 'goal' | ✅ | ✅ name='goal' | ✅ OK |
| `name` | ✅ Required | ✅ | ✅ events.goal_name | ✅ OK |
| `path` | ✅ Required | ✅ | ✅ events.path | ✅ OK |
| `page_number` | ✅ Required | ✅ | ✅ events.page_number | ✅ OK |
| `timestamp` | ✅ Required | ⚠️ dedup only | ❌ **Not stored** | 🟠 ISSUE 2 |
| `value` | ✅ Optional | ✅ | ✅ events.goal_value | ✅ OK |
| `properties` | ✅ Optional | ✅ | ✅ events.properties | ✅ OK |

---

## Recommendations

### For Issue 1 (entered_at/exited_at):

1. Add columns to events table schema:
   ```sql
   entered_at DateTime64(3),
   exited_at DateTime64(3),
   ```

2. Update TrackingEvent interface:
   ```typescript
   entered_at?: string;  // For pageviews
   exited_at?: string;   // For pageviews
   ```

3. Update `deserializePageview()`:
   ```typescript
   return {
     ...baseEvent,
     // ... existing fields
     entered_at: toClickHouseDateTime(new Date(action.entered_at)),
     exited_at: toClickHouseDateTime(new Date(action.exited_at)),
   };
   ```

### For Issue 2 (goal timestamp):

1. Add column to events table:
   ```sql
   goal_timestamp DateTime64(3),
   ```

2. Update `deserializeGoal()`:
   ```typescript
   return {
     ...baseEvent,
     // ... existing fields
     goal_timestamp: toClickHouseDateTime(new Date(action.timestamp)),
   };
   ```

### For Issue 3 (Pages MV):

After fixing Issue 1, update `pages_mv`:
```sql
e.entered_at as entered_at,
e.exited_at as exited_at,
```

### For Issue 4 (TypeScript types):

Update TrackingEvent interface to mark fields as required:
```typescript
dedup_token: string;
page_number: number;
_version: number;
goal_name: string;
goal_value: number;
```

---

## Summary

| Issue | Severity | Field(s) | Root Cause |
|-------|----------|----------|------------|
| 1 | 🔴 Critical | `entered_at`, `exited_at` | Handler doesn't use, schema missing columns |
| 2 | 🟠 High | Goal `timestamp` | Handler only uses for dedup, schema missing column |
| 3 | 🟡 Medium | Pages MV timestamps | Depends on Issue 1 |
| 4 | 🟢 Low | TypeScript types | Optional vs required mismatch |

---

## Why Tests Don't Catch These Issues

### Issue 1 & 2: Tests Use Partial Assertions

**Handler test** (`session-payload.handler.spec.ts:108-128`):
```typescript
it('converts pageview action to screen_view event', async () => {
  // Input includes entered_at, exited_at
  const payload = createPayload({
    actions: [createPageviewAction({ path: '/about', page_number: 2 })],
  });

  await handler.handle(payload, '8.8.8.8');

  const events = bufferService.addBatch.mock.calls[0][0];
  expect(events[0]).toMatchObject({
    session_id: 'sess-123',
    name: 'screen_view',
    path: '/about',
    page_number: 2,
    page_duration: 5000,
    max_scroll: 50,
    // ❌ NO assertion for entered_at
    // ❌ NO assertion for exited_at
  });
});
```

**Problem**: `toMatchObject()` only checks that expected properties exist - it does NOT fail if properties are missing from the output. The test passes even though `entered_at` and `exited_at` are dropped.

**Same for goals** (`session-payload.handler.spec.ts:160-186`):
```typescript
expect(goalEvent).toMatchObject({
  name: 'goal',
  goal_name: 'purchase',
  goal_value: 99.99,
  page_number: 7,
  // ❌ NO assertion for goal_timestamp
});
```

### DTO Tests Only Validate Input, Not Output Transformation

**DTO test** (`session-payload.dto.spec.ts:13-29`):
```typescript
const validPageview = {
  type: 'pageview',
  path: '/home',
  page_number: 1,
  duration: 5000,
  scroll: 75,
  entered_at: Date.now() - 5000,  // ✅ Validated here
  exited_at: Date.now(),           // ✅ Validated here
};

it('accepts valid pageview action', async () => {
  const dto = plainToInstance(PageviewActionDto, validPageview);
  const errors = await validate(dto);
  expect(errors).toHaveLength(0);  // ✅ Input valid
});
```

**Gap**: DTO tests verify the SDK can SEND `entered_at`/`exited_at`, but no test verifies the handler STORES them.

### Issue 3: Tests Are Unit Tests, Not Integration Tests

```typescript
// Handler tests mock the buffer service
{
  provide: EventBufferService,
  useValue: { addBatch: jest.fn().mockResolvedValue(undefined) },
}
```

**Problem**: Tests never actually insert into ClickHouse or verify materialized views. The Pages MV calculation issue is a schema/database-level problem that unit tests can't catch.

### Issue 4: TypeScript Types Are Compile-Time

TypeScript's `?` optional markers are compile-time only. Runtime tests don't verify type correctness - the handler always provides these values, so code works correctly at runtime despite the type mismatch.

---

## Missing Test Cases

To catch these issues, the following tests should be added:

### Test 1: Verify all pageview fields are stored
```typescript
it('preserves entered_at and exited_at timestamps', async () => {
  const entered = Date.now() - 5000;
  const exited = Date.now();

  const payload = createPayload({
    actions: [createPageviewAction({
      entered_at: entered,
      exited_at: exited
    })],
  });

  await handler.handle(payload, null);

  const events = bufferService.addBatch.mock.calls[0][0];
  expect(events[0].entered_at).toBeDefined();  // Would fail!
  expect(events[0].exited_at).toBeDefined();   // Would fail!
});
```

### Test 2: Verify goal timestamp is stored
```typescript
it('preserves goal timestamp', async () => {
  const timestamp = Date.now();

  const payload = createPayload({
    actions: [createGoalAction({ timestamp })],
  });

  await handler.handle(payload, null);

  const events = bufferService.addBatch.mock.calls[0][0];
  expect(events[0].goal_timestamp).toBeDefined();  // Would fail!
});
```

### Test 3: Integration test for database schema
```typescript
// e2e test that actually inserts and reads from ClickHouse
it('stores all pageview fields in database', async () => {
  // POST to /api/track with full payload
  // Query events table
  // Assert entered_at, exited_at columns exist and have values
});
```
