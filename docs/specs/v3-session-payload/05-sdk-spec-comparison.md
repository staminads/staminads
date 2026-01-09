# SDK Spec Comparison Analysis

**Comparing**: `05-sdk.md` (original) vs `05-sdk-implementation.md` (new, no backward compat)

## Summary

| Aspect | Original Spec | New Spec | Status |
|--------|--------------|----------|--------|
| Backward compatibility | Optional dual-mode | None | ✅ Correct per user request |
| DurationTracker | Not explicitly addressed | Remove entirely | ⚠️ Needs verification |
| Legacy sender methods | Keep alongside new | Remove entirely | ✅ Correct |
| useSessionPayload config | Optional | Not included | ✅ Correct |
| Public API changes | Not detailed | Documented | ✅ |

---

## Detailed Comparison

### 1. SessionState Class

| Feature | Original Spec | New Spec | Match? |
|---------|--------------|----------|--------|
| addPageview() | ✅ Specified | ✅ Specified | ✅ |
| addGoal() | ✅ Specified | ✅ Specified | ✅ |
| updateScroll() | ✅ Specified | ✅ Specified | ✅ |
| buildPayload() | ✅ Specified | ✅ Specified | ✅ |
| applyCheckpoint() | ✅ Specified | ✅ Specified | ✅ |
| markAttributesSent() | ✅ Specified | ✅ Specified | ✅ |
| finalizeForUnload() | ✅ Specified | ✅ Specified | ✅ |
| persist() / restore() | ✅ Specified | ✅ Specified | ✅ |
| MAX_ACTIONS limit | ✅ Specified | ✅ Specified | ✅ |

**Status**: ✅ Already implemented in `sdk/src/core/session-state.ts`

---

### 2. Sender Methods

| Method | Original Spec | New Spec | Implementation |
|--------|--------------|----------|----------------|
| sendSession() | ✅ Add | ✅ Keep | ✅ Already exists |
| sendSessionBeacon() | ✅ Add | ✅ Keep | ✅ Already exists |
| send() | Keep | ❌ Remove | Pending |
| sendBeacon() | Keep | ❌ Remove | Pending |
| flushQueue() | Keep | ❌ Remove | Pending |
| queuePayload() | Keep | ❌ Remove | Pending |
| getQueueLength() | Keep | ❌ Remove | Pending |

**Status**: V3 methods exist, legacy methods need removal

---

### 3. SDK Integration

| Change | Original Spec | New Spec | Status |
|--------|--------------|----------|--------|
| Add sessionState property | ✅ | ✅ | Pending |
| Add sendDebounceTimeout | ✅ | ✅ | Pending |
| Initialize SessionState | ✅ | ✅ | Pending |
| Modify trackPageView() | ✅ | ✅ | Pending |
| Modify trackGoal() | ✅ | ✅ | Pending |
| Add sendPayload() helper | ✅ | ✅ | Pending |
| Add buildAttributes() helper | ✅ | ✅ | Pending |
| Add scheduleDebouncedSend() | ✅ | ✅ | Pending |
| Modify onUnload/flushOnce | ✅ | ✅ | Pending |
| Modify heartbeat | ✅ | ✅ | Pending |

---

### 4. Removals (New Spec Only)

The new spec explicitly removes these (original spec kept them for dual-mode):

| Item | Location | Reason |
|------|----------|--------|
| `DurationTracker` class | `sdk/src/core/duration.ts` | Replaced by SessionState timing |
| `sendEvent()` method | `sdk/src/sdk.ts` | Replaced by sendPayload() |
| `onScrollMilestone()` | `sdk/src/sdk.ts` | No longer needed |
| `onTick()` | `sdk/src/sdk.ts` | No longer needed |
| `updateSession()` | `sdk/src/sdk.ts` | No longer needed |
| `EventName` type | `sdk/src/types.ts` | Not used in V3 |
| `TrackEventPayload` interface | `sdk/src/types.ts` | Replaced by SessionPayload |
| `QueuedPayload` interface | `sdk/src/types.ts` | Queue removed |
| `FocusState` type | `sdk/src/types.ts` | DurationTracker removed |

---

### 5. Public API Impact

| Method | Original Spec | New Spec | Resolution |
|--------|--------------|----------|------------|
| `trackPageView()` | Modify | Modify | Use SessionState.addPageview() |
| `trackGoal()` | Modify | Modify | Use SessionState.addGoal() |
| `trackEvent()` | Not mentioned | Removed | Use trackGoal() instead |
| `getFocusDuration()` | Not mentioned | ⚠️ Needs decision | See below |
| `debug()` | Not mentioned | Update | Remove focusState, add actionsCount |

**`getFocusDuration()` Resolution Options**:
1. **Calculate from SessionState**: Sum completed pageview durations + current page time
2. **Deprecate**: V3 tracks page-level duration, not session-level focus
3. **Keep simple counter**: Maintain a focus counter separate from SessionState

**Recommendation**: Option 1 - Calculate from SessionState for backward compatibility.

---

### 6. Configuration

| Option | Original Spec | New Spec | Status |
|--------|--------------|----------|--------|
| `navigationDebounce` | ✅ Optional | Not needed (hardcoded 100ms) | Simplify |
| `useSessionPayload` | ✅ Optional (dual-mode) | ❌ Not included | Correct |

---

### 7. Test Coverage

| Test Category | Original Spec | New Spec | Status |
|---------------|--------------|----------|--------|
| SessionState unit tests (1-9, 16) | ✅ | ✅ | Implemented |
| SDK integration tests (10-15) | ✅ | ✅ | Partially implemented |
| Sender tests | ✅ | ✅ | V3 methods need tests |

---

## Issues Found

### Issue 1: DurationTracker Removal Impact

**Original spec** doesn't explicitly say to remove DurationTracker.
**New spec** removes it entirely.

**Analysis**: DurationTracker is used for:
1. Focus duration tracking → SessionState handles via entered_at/exited_at ✅
2. Tick callbacks → Not needed in V3 (periodic sends via heartbeat) ✅
3. Focus state for debug → Can be simplified ✅

**Verdict**: ✅ Safe to remove

### Issue 2: getFocusDuration() Public API

**Original spec** doesn't mention this method.
**New spec** should address it.

**Current implementation**:
```typescript
async getFocusDuration(): Promise<number> {
  return this.durationTracker?.getFocusDurationMs() || 0;
}
```

**Proposed V3 implementation**:
```typescript
async getFocusDuration(): Promise<number> {
  if (!this.sessionState) return 0;

  // Sum completed pageview durations
  const actions = this.sessionState.getActions();
  let total = 0;
  for (const action of actions) {
    if (action.type === 'pageview') {
      total += action.duration;
    }
  }

  // Add current page time
  const currentPage = this.sessionState.getCurrentPage();
  if (currentPage) {
    total += Date.now() - currentPage.entered_at;
  }

  return total;
}
```

### Issue 3: Heartbeat Integration

**Original spec** shows modifying `sendPingEvent()` to use sendPayload().
**New spec** matches this.

**Current sdk.ts** (line 541-550):
```typescript
private sendPingEvent(): void {
  const tierResult = this.getCurrentTier();
  const totalActiveMs = this.getTotalActiveMs();
  const pageActiveMs = this.getPageActiveMs();

  this.sendEvent('ping', {
    tier: String(tierResult?.index ?? 0),
    active_time: String(Math.round(totalActiveMs / 1000)),
    page_active_time: String(Math.round(pageActiveMs / 1000)),
  });
}
```

**Proposed V3**:
```typescript
private sendPingEvent(): void {
  if (!this.sessionState) return;

  // Update scroll from ScrollTracker
  if (this.scrollTracker) {
    this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
  }

  // Send periodic payload (non-blocking)
  this.sendPayload().catch(() => {});
}
```

**Note**: The tier metadata (active_time, page_active_time) is lost in V3. This is acceptable because:
- Server calculates duration from pageview entered_at/exited_at
- Heartbeat's purpose is to keep session alive and update scroll
- Tier info was for debugging, not analytics

---

## Recommendations

1. **Update `05-sdk-implementation.md`** to include:
   - `getFocusDuration()` implementation
   - `debug()` method updates
   - Note about lost heartbeat tier metadata

2. **Verify no other dependencies** on removed components:
   - ✅ DurationTracker - only used in sdk.ts
   - ✅ FocusState - only used in types.ts and duration.ts
   - ✅ EventName - only used in sdk.ts and types.ts
   - ✅ TrackEventPayload - only used in sdk.ts, sender.ts, types.ts

3. **Test file updates needed**:
   - `sdk/src/transport/sender.test.ts` - remove legacy send tests
   - `sdk/src/core/duration.test.ts` - delete
   - `sdk/src/sdk.heartbeat.test.ts` - update for V3
   - `sdk/src/sdk.page-duration.test.ts` - update for V3

---

## Conclusion

The new spec (`05-sdk-implementation.md`) is **mostly accurate** for a no-backward-compatibility implementation. Minor additions needed:

1. Add `getFocusDuration()` implementation using SessionState
2. Add `debug()` method updates
3. List test files that need updating
4. Note that heartbeat tier metadata is intentionally dropped

The original spec (`05-sdk.md`) is designed for **optional dual-mode migration**, which is why it doesn't explicitly remove legacy code. The user requested no backward compatibility, so the new spec correctly removes all legacy components.
