# Dashboard Email Subscription - Implementation Gaps

Review of the subscription feature implementation against the plan. Items below are either missing, incomplete, or could be improved.

**Last Updated:** 2026-01-13

---

## Fixed Issues ✅

### 1. ~~Missing Workspace Access Validation~~ (Fixed)
**Status:** ✅ Fixed
**Commit:** Added `WorkspaceAuthGuard` to all subscription endpoints

Changed from `JwtAuthGuard` to `WorkspaceAuthGuard` on `list`, `create`, `update`, `pause`, `resume`, `delete`, and `sendNow` endpoints. Added `MembersModule` import to `SubscriptionsModule`.

**Files modified:**
- `api/src/subscriptions/subscriptions.controller.ts`
- `api/src/subscriptions/subscriptions.module.ts`

**Tests added:** 8 E2E tests in `api/test/subscriptions.e2e-spec.ts` (Workspace Access Control section)

---

### 2. ~~No Metric/Dimension Validation in DTO~~ (Fixed)
**Status:** ✅ Fixed
**Commit:** Added `@IsIn` validation for metrics and dimensions

Changed from `@IsString({ each: true })` to `@IsIn([...AVAILABLE_METRICS], { each: true })` for metrics and `@IsIn([...AVAILABLE_DIMENSIONS], { each: true })` for dimensions.

**Files modified:**
- `api/src/subscriptions/dto/create-subscription.dto.ts`
- `api/src/subscriptions/dto/update-subscription.dto.ts`

**Tests added:** 12 unit tests in `api/src/subscriptions/dto/create-subscription.dto.spec.ts`

---

### 3. ~~Potential Duplicate Report Race Condition~~ (Fixed)
**Status:** ✅ Fixed
**Commit:** Added re-fetch check before processing subscription

The scheduler now re-fetches the subscription before processing and skips if:
- Subscription no longer exists
- Status changed to non-active
- `next_send_at` changed (another instance already processed it)

**Files modified:**
- `api/src/subscriptions/scheduler/subscription-scheduler.service.ts`

**Tests added:** 4 unit tests in `api/src/subscriptions/scheduler/subscription-scheduler.service.spec.ts` (race condition prevention section)

---

### 5. ~~No Error Handling for Empty User Email~~ (Fixed)
**Status:** ✅ Fixed
**Commit:** Added email validation before sending report

The scheduler now validates `if (!user.email)` and marks subscription as failed with descriptive error.

**Files modified:**
- `api/src/subscriptions/scheduler/subscription-scheduler.service.ts`

**Tests added:** 2 unit tests in `api/src/subscriptions/scheduler/subscription-scheduler.service.spec.ts` (email validation section)

---

### 7. ~~Missing OpenAPI Response Types~~ (Fixed)
**Status:** ✅ Fixed
**Commit:** Added `@ApiResponse` decorators to all endpoints

Added response type documentation for all subscription controller endpoints.

**Files modified:**
- `api/src/subscriptions/subscriptions.controller.ts`

---

## Remaining Issues

### 4. Skipped E2E Test for sendNow
**Priority:** Medium
**File:** `api/test/subscriptions.e2e-spec.ts`

The `sendNow` endpoint test is skipped because it requires complex setup (workspace database with analytics data).

```typescript
it.skip('sends report immediately', async () => {
  // Test requires workspace database with analytics data
});
```

**Impact:** The manual "Send Now" feature isn't fully tested.

---

### 6. Missing MJML Template File
**Priority:** Low
**File:** `api/src/mail/templates/report.mjml` (doesn't exist)

The plan specified creating a separate MJML template file, but the implementation uses an inline template via `getDefaultTemplate()` method.

**Current location:** `api/src/subscriptions/report/report-generator.service.ts:326-417`

**Impact:** Template changes require code changes and redeployment instead of just editing a template file.

---

### 8. Inconsistent Filter Storage Format
**Priority:** Low
**Files:**
- `api/src/subscriptions/subscriptions.service.ts`
- `api/src/subscriptions/report/report-generator.service.ts`

Filters are stored as JSON string in database but handled inconsistently:

```typescript
// Service stores as string
filters: JSON.stringify(dto.filters || []),

// Generator parses manually
const filters = JSON.parse(subscription.filters || '[]');
```

**Suggestion:** Use a helper or entity method for consistent serialization/deserialization.

---

### 9. No Timezone Display in Email
**Priority:** Low
**File:** `api/src/subscriptions/report/report-generator.service.ts`

The email template shows the date range but doesn't indicate the timezone, which could confuse users in different timezones.

---

### 10. Missing Subscription Edit UI
**Priority:** Low
**File:** `console/src/routes/_authenticated/workspaces/$workspaceId/account.tsx`

The Notifications section allows pause/resume/delete but doesn't have an "Edit" option to modify an existing subscription's settings (frequency, metrics, dimensions).

---

## Summary

| Priority | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 2 | 2 | 0 |
| Medium | 3 | 2 | 1 |
| Low | 5 | 1 | 4 |
| **Total** | **10** | **5** | **5** |

---

## Remaining Work (Priority Order)

1. **#4** - Add E2E test for sendNow endpoint (medium)
2. **#6** - Extract MJML template to file (low)
3. **#8** - Standardize filter serialization (low)
4. **#9** - Add timezone to email template (low)
5. **#10** - Add subscription edit UI (low)
