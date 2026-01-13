# Bug Report: Array Sort Mutation in Analytics Cache Key Generation

**Date:** 2026-01-13
**Severity:** High
**Status:** Fixed

## Summary

The analytics service's cache key generation was mutating input arrays by calling `.sort()` directly, causing metric ordering to change and breaking downstream formatting logic.

## Root Cause

In `api/src/analytics/analytics.service.ts:455-456`, the cache key generation called `.sort()` directly on input arrays:

```typescript
// BEFORE (buggy)
dto.metrics.sort().join(','),
(dto.dimensions || []).sort().join(','),
```

JavaScript's `Array.sort()` **mutates the original array in place**. This changed:
- `['sessions', 'median_duration']` → `['median_duration', 'sessions']` (alphabetical)

## Symptoms

### 1. TimeScore Displayed as Raw Seconds
- **Expected:** `7m 51s`
- **Actual:** `384`

The `formatMetric()` function received `'sessions'` as the key instead of `'median_duration'`, so the duration formatting branch was never executed.

### 2. Sessions Appeared as Floats (Red Herring)
Initial investigation suspected ClickHouse was returning floats (e.g., `164.5`). E2E testing confirmed ClickHouse returns proper integers. The float values in the screenshot were from a different data source or stale cache.

## Affected Areas

### Email Reports (Subscription Reports)
- **File:** `api/src/subscriptions/report/report-generator.service.ts`
- **Impact:** Dimension breakdown tables showed:
  - TimeScore as raw seconds instead of formatted duration
  - Incorrect metric associations

### Dashboard (Potential)
Any dashboard widget that:
1. Queries analytics with multiple metrics
2. Relies on metric order after the query

**Affected widgets:**
- Dimension breakdown tables (Landing Pages, Referrers, Channels, etc.)
- Any component using `analyticsService.query()` with ordered metrics

### API Endpoints
- `POST /api/analytics.query` - Metrics array mutated after first cache key generation
- `POST /api/analytics.extremes` - Same issue with metrics array

## Fix

Use spread operator to create copies before sorting:

```typescript
// AFTER (fixed)
[...dto.metrics].sort().join(','),
[...(dto.dimensions || [])].sort().join(','),
```

**File:** `api/src/analytics/analytics.service.ts:455-456`

## Testing Added

### Unit Tests
- `api/src/subscriptions/report/report-generator.service.spec.ts`
  - Verifies TimeScore formatted as duration in dimension breakdowns
  - Verifies HTML renders correctly

### E2E Tests
- `api/test/report-generation.e2e-spec.ts` (new file)
  - Tests full report generation flow with real ClickHouse data
  - Verifies sessions are integers
  - Verifies TimeScore is formatted as duration

- `api/test/analytics.e2e-spec.ts`
  - Added tests verifying sessions are integers when grouped by dimension

## Verification

Run the following to verify the fix:

```bash
# Unit tests
cd api && npm test -- report-generator.service.spec.ts

# E2E tests
cd api && npm run test:e2e -- report-generation.e2e-spec.ts
cd api && npm run test:e2e -- analytics.e2e-spec.ts
```

## Lessons Learned

1. **Never call `.sort()` on input arrays** - Always create a copy first with spread operator or `.slice()`
2. **Array methods that mutate:** `sort()`, `reverse()`, `splice()`, `push()`, `pop()`, `shift()`, `unshift()`, `fill()`
3. **Add E2E tests for data formatting** - Unit tests with mocks may not catch issues in the data pipeline

## Related Files

- `api/src/analytics/analytics.service.ts` - Fixed
- `api/src/subscriptions/report/report-generator.service.ts` - Affected (no changes needed)
- `console/src/components/dashboard/*` - Potentially affected (verify after deployment)
