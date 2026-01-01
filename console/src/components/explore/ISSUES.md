# Explore Feature - Known Issues & Incomplete Implementations

This document tracks gaps identified during the initial implementation of the Explore feature.

---

## Critical Issues

### 1. ~~Missing URL search param validation for explore-specific params~~ ✅ FIXED

**Status:** Resolved

**Solution Applied:**
- Extended `WorkspaceSearch` in `types/dashboard.ts` to include explore params (dimensions, filters, minSessions)
- Updated `validateSearch` in `$workspaceId.tsx` to validate all explore-specific params
- Updated `useExploreParams.ts` to use the shared `WorkspaceSearch` type

---

### 2. No "None" option for comparison picker

**File:** `components/dashboard/ComparisonPicker.tsx`

**Problem:** The `ComparisonPicker` only has "previous_period" and "previous_year" options. The explore page checks `comparison !== 'none'` but there's no UI option to disable comparison.

**Fix:** Add a "None" option to `COMPARISON_OPTIONS`:

```typescript
const COMPARISON_OPTIONS: { value: ComparisonMode; label: string }[] = [
  { value: 'none', label: 'No comparison' },  // Add this
  { value: 'previous_period', label: 'Previous period' },
  { value: 'previous_year', label: 'Previous year' },
]
```

---

### 3. ~~Child data not cached with TanStack Query~~ ✅ FIXED

**Status:** Resolved

**Solution Applied:**
- Added `useQueryClient` import and instance in `explore.tsx`
- Replaced direct `api.analytics.query()` call with `queryClient.fetchQuery()`
- Added comprehensive query key including all relevant parameters for proper cache invalidation
- Set `staleTime: 30_000` (30 seconds) for child data caching

```typescript
const response = await queryClient.fetchQuery({
  queryKey: ['explore', 'children', record.key, workspaceId, dimensionsToFetch, childFilters, dateRange, timezone, minSessions, showComparison],
  queryFn: () => api.analytics.query(query),
  staleTime: 30_000,
})
```

---

## Moderate Issues

### 4. ~~No dedicated max median duration query~~ ✅ FIXED

**Status:** Resolved

**Solution Applied:**
- Created new `/api/analytics.extremes` endpoint that returns min/max of a metric across grouped data
- Added `ExtremesQueryDto`, `buildExtremesQuery`, and service method
- Frontend now uses `api.analytics.extremes()` to get the true max median duration
- Heat map coloring now uses server-side extremes instead of tracking max from loaded rows
- **Enhancement:** Dynamic max update when children are expanded with higher values (ensures accurate heat map coloring at all hierarchy levels)

```typescript
const { data: extremesData } = useQuery({
  queryKey: ['explore', 'extremes', workspaceId, dimensions[0], dateRange, filters, minSessions, timezone],
  queryFn: () => api.analytics.extremes({
    workspace_id: workspaceId,
    metric: 'median_duration',
    groupBy: [dimensions[0]],
    dateRange,
    filters,
    havingMinSessions: minSessions,
  }),
  enabled: dimensions.length > 0,
  staleTime: 30_000,
})
```

---

### 5. Error handling for child fetches is silent

**File:** `routes/_authenticated/workspaces/$workspaceId/explore.tsx`

**Problem:** When a child fetch fails, errors are only logged to console. Users see no feedback.

**Current code:**
```typescript
} catch (err) {
  console.error('Failed to fetch children:', err)
  // No user feedback
}
```

**Fix:** Add error notification:

```typescript
import { message } from 'antd'

} catch (err) {
  console.error('Failed to fetch children:', err)
  message.error('Failed to load data. Please try again.')
  setReportData((prev) => setRowLoading(prev, record.key, false))
}
```

---

### 6. No tests written

**Problem:** Zero test coverage for new components and utilities.

**Files needing tests:**
- `lib/explore-utils.ts` - Unit tests for `calculateChildrenDimensionsAndFilters`, `transformApiRowsToExploreRows`, `mergeComparisonData`, `getHeatMapColor`
- `hooks/useExploreParams.ts` - Hook tests for URL state management
- `components/explore/*.tsx` - Component tests

---

### 7. Filter operator labels not fully human-readable

**File:** `components/explore/ExploreFilterBuilder.tsx`

**Problem:** While labels are defined in `EXPLORE_OPERATORS`, they use slightly inconsistent formatting compared to other parts of the app.

**Current:**
```typescript
const EXPLORE_OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'not equals' },
  // ...
]
```

**Suggested:** Consider title case for consistency: "Equals", "Not Equals", etc.

---

## Minor Issues

### 8. Custom dimension names not displayed

**File:** `components/explore/DimensionSelector.tsx`, `lib/explore-utils.ts`

**Problem:** If a workspace has custom dimensions with friendly names configured (e.g., cd_1 = "Channel Group"), we display "Cd 1" instead of the configured name.

**Fix:** Fetch workspace custom dimension configuration and map slot names to friendly names in `getDimensionLabel()`.

---

### 9. No virtualization for large datasets

**File:** `components/explore/ExploreTable.tsx`

**Problem:** Limited to 100 rows per level, but if all 100 are rendered with multiple expanded children, performance could degrade. No virtual scrolling implemented.

**Fix:** Consider using `react-window` or Ant Design's virtual table for large datasets.

---

### 10. Keyboard accessibility incomplete

**File:** `components/explore/ExploreTable.tsx`

**Problem:** The custom expand icon SVG may not be fully keyboard accessible. Missing `tabIndex`, `role`, and `onKeyDown` handlers.

**Fix:**
```typescript
<span
  role="button"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      triggerExpand(record, e as any)
    }
  }}
  // ... rest of props
>
```

---

## Implementation Priority

1. **High:** ~~Issues #1, #3~~ ✅ FIXED, Issue #2 remaining - Core functionality issues
2. **Medium:** Issues #4, #5, #6 - Quality and reliability
3. **Low:** Issues #7, #8, #9, #10 - Polish and edge cases
