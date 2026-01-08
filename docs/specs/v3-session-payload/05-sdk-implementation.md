# V3 SDK Implementation Spec

**Version**: 6.0.0
**Status**: Implementation Ready
**Breaking Change**: Yes - removes legacy event-based tracking

## Overview

This spec details the complete SDK refactoring for V3 session payload. The SDK switches from sending individual events (`screen_view`, `ping`, `goal`) to sending cumulative session payloads with an `actions[]` array.

**Key changes:**
- Replace `sendEvent()` with `sendPayload()` using SessionState
- Remove legacy event types (`screen_view`, `ping`, `scroll`)
- Single endpoint: `/api/track.session`
- Simplified heartbeat (scroll updates + periodic sends only)
- SDK version bump to 6.0.0

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            StaminadsSDK                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Components (unchanged):                                                     │
│    - SessionManager (visitor_id, session lifecycle)                         │
│    - DurationTracker (focus duration - REMOVED, replaced by SessionState)   │
│    - ScrollTracker (max scroll percentage)                                  │
│    - NavigationTracker (SPA navigation detection)                           │
│    - DeviceDetector (device info)                                           │
│    - Sender (HTTP transport)                                                │
│                                                                             │
│  New Component:                                                             │
│    - SessionState (actions[], currentPage, checkpoint)                      │
│                                                                             │
│  Removed:                                                                    │
│    - DurationTracker (replaced by SessionState duration tracking)           │
│    - sendEvent() method (replaced by sendPayload())                         │
│    - TrackEventPayload type (replaced by SessionPayload)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `sdk/src/sdk.ts` | Modify | Major refactoring for SessionState |
| `sdk/src/types.ts` | Modify | Remove legacy event types, simplify |
| `sdk/src/core/session-state.ts` | Keep | Already implemented |
| `sdk/src/types/session-state.ts` | Keep | Already implemented |
| `sdk/src/transport/sender.ts` | Modify | Remove legacy send(), keep sendSession() |
| `sdk/src/core/duration.ts` | Remove | No longer needed |
| `sdk/src/core/duration.test.ts` | Remove | No longer needed |

---

## Detailed Changes

### 1. `sdk/src/sdk.ts`

#### 1.1 Imports

```typescript
// BEFORE
import type {
  StaminadsConfig,
  InternalConfig,
  TrackEventPayload,
  GoalData,
  SessionDebugInfo,
  DeviceInfo,
  EventName,
  HeartbeatTier,
  HeartbeatState,
} from './types';
import { DurationTracker } from './core/duration';

// AFTER
import type {
  StaminadsConfig,
  InternalConfig,
  GoalData,
  SessionDebugInfo,
  DeviceInfo,
  HeartbeatTier,
  HeartbeatState,
} from './types';
import type { SessionAttributes } from './types/session-state';
import { SessionState, SessionStateConfig } from './core/session-state';
```

#### 1.2 Constants

```typescript
// BEFORE
const SDK_VERSION = '5.0.0';

// AFTER
const SDK_VERSION = '6.0.0';

// NEW: Debounce constant
const SEND_DEBOUNCE_MS = 100;
```

#### 1.3 Class Properties

```typescript
// REMOVE
private durationTracker: DurationTracker | null = null;

// ADD
private sessionState: SessionState | null = null;
private sendDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
```

#### 1.4 `initializeAsync()` - Complete Replacement

```typescript
private async initializeAsync(userConfig: StaminadsConfig): Promise<void> {
  // Validate required fields
  if (!userConfig.workspace_id) {
    throw new Error('workspace_id is required');
  }
  if (!userConfig.endpoint) {
    throw new Error('endpoint is required');
  }

  // Check for bots
  if (isBot()) {
    console.log('[Staminads] Bot detected, tracking disabled');
    return;
  }

  // Merge config
  this.config = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  } as InternalConfig;

  // Validate and normalize heartbeat tiers
  this.config.heartbeatTiers = this.validateTiers(this.config.heartbeatTiers);

  // Validate heartbeat max duration
  if (this.config.heartbeatMaxDuration !== 0 &&
      this.config.heartbeatMaxDuration < MIN_HEARTBEAT_MAX_DURATION) {
    this.config.heartbeatMaxDuration = MIN_HEARTBEAT_MAX_DURATION;
  }

  // Initialize storage
  this.storage = new Storage();
  this.tabStorage = new TabStorage();

  // Initialize device detector
  this.deviceDetector = new DeviceDetector();
  this.deviceInfo = await this.deviceDetector.detectWithClientHints();

  // Set mobile device flag for heartbeat intervals
  this.isMobileDevice = this.deviceInfo?.device !== 'desktop';

  // Initialize session manager
  this.sessionManager = new SessionManager(
    this.storage,
    this.tabStorage,
    this.config
  );
  const session = this.sessionManager.getOrCreateSession();

  // Initialize sender
  this.sender = new Sender(this.config.endpoint, this.storage, this.config.debug);

  // Initialize scroll tracker
  if (this.config.trackScroll) {
    this.scrollTracker = new ScrollTracker();
    // No milestone callback needed - we just track max scroll
    this.scrollTracker.start();
  }

  // Initialize navigation tracker
  if (this.config.trackSPA) {
    this.navigationTracker = new NavigationTracker();
    this.navigationTracker.setNavigationCallback((url) => this.onNavigation(url));
    this.navigationTracker.start();
  }

  // === NEW: Initialize SessionState ===
  const sessionStateConfig: SessionStateConfig = {
    workspace_id: this.config.workspace_id,
    session_id: session.id,
    created_at: session.created_at,
  };
  this.sessionState = new SessionState(sessionStateConfig);
  this.sessionState.restore(); // Restore from sessionStorage if available

  // Add initial pageview
  this.sessionState.addPageview(window.location.pathname);

  // Bind events
  this.bindEvents();

  // Start tracking
  this.isTracking = true;
  this.isInitialized = true;

  // Initialize heartbeat state
  const now = Date.now();
  this.heartbeatState.pageStartTime = now;
  this.heartbeatState.activeStartTime = now;

  // Start heartbeat
  this.startHeartbeat();

  // Send initial payload (immediate, with attributes)
  await this.sendPayload();

  if (this.config.debug) {
    console.log('[Staminads] Initialized', {
      session_id: session.id,
      visitor_id: this.sessionManager.getVisitorId(),
      device: this.deviceInfo,
    });
  }
}
```

#### 1.5 Navigation Handler - Complete Replacement

```typescript
private onNavigation(url: string): void {
  if (!this.sessionState) return;

  if (this.config?.debug) {
    console.log('[Staminads] Navigation:', url);
  }

  // Update scroll before finalizing page
  if (this.scrollTracker) {
    this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
  }

  // Add new pageview (this finalizes the previous page)
  this.sessionState.addPageview(window.location.pathname);

  // Reset scroll tracking for new page
  this.scrollTracker?.reset();

  // Reset page timer
  this.resetPageActiveTime();

  // Optionally reset session heartbeat timer
  if (this.config?.resetHeartbeatOnNavigation) {
    this.resetHeartbeatState();
    this.startHeartbeat();
  }

  // Debounced send (navigation can be rapid in SPAs)
  this.scheduleDebouncedSend();

  // Persist state
  this.sessionState.persist();
}
```

#### 1.6 Visibility/Unload Handlers

```typescript
private onVisibilityChange = (): void => {
  if (document.visibilityState === 'hidden') {
    this.stopHeartbeat(true);
    this.flushOnce();
  } else if (document.visibilityState === 'visible') {
    this.flushed = false;
    if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
      this.resumeHeartbeat();
    }
  }
};

private flushOnce(): void {
  if (this.flushed) return;
  this.flushed = true;

  if (!this.sessionState || !this.sender) return;

  // Update scroll before finalizing
  if (this.scrollTracker) {
    this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
  }

  // Finalize current page
  this.sessionState.finalizeForUnload();

  // Build and send via beacon
  const attributes = this.buildAttributes();
  const payload = this.sessionState.buildPayload(attributes);
  this.sender.sendSessionBeacon(payload);

  // Persist final state
  this.sessionState.persist();
}
```

#### 1.7 Heartbeat Handler - Simplified

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

#### 1.8 New Helper Methods

```typescript
/**
 * Schedule a debounced send (for rapid navigations)
 */
private scheduleDebouncedSend(): void {
  if (this.sendDebounceTimeout) {
    clearTimeout(this.sendDebounceTimeout);
  }

  this.sendDebounceTimeout = setTimeout(async () => {
    this.sendDebounceTimeout = null;
    await this.sendPayload();
  }, SEND_DEBOUNCE_MS);
}

/**
 * Send session payload to server
 */
private async sendPayload(): Promise<void> {
  if (!this.sessionState || !this.sender) return;

  const attributes = this.buildAttributes();
  const payload = this.sessionState.buildPayload(attributes);

  const result = await this.sender.sendSession(payload);

  if (result.success) {
    // Mark attributes as sent after first successful send
    if (!this.sessionState.hasAttributesSent()) {
      this.sessionState.markAttributesSent();
    }

    // Apply checkpoint from server
    if (result.checkpoint !== undefined) {
      this.sessionState.applyCheckpoint(result.checkpoint);
    }

    // Persist updated state
    this.sessionState.persist();
  }
}

/**
 * Build session attributes from current state
 */
private buildAttributes(): SessionAttributes {
  const session = this.sessionManager?.getSession();
  const device = this.deviceInfo;

  return {
    landing_page: session?.landing_page || window.location.href,
    referrer: session?.referrer || undefined,
    utm_source: session?.utm?.source || undefined,
    utm_medium: session?.utm?.medium || undefined,
    utm_campaign: session?.utm?.campaign || undefined,
    utm_term: session?.utm?.term || undefined,
    utm_content: session?.utm?.content || undefined,
    utm_id: session?.utm?.id || undefined,
    utm_id_from: session?.utm?.id_from || undefined,
    screen_width: device?.screen_width,
    screen_height: device?.screen_height,
    viewport_width: device?.viewport_width,
    viewport_height: device?.viewport_height,
    device: device?.device,
    browser: device?.browser,
    browser_type: device?.browser_type || undefined,
    os: device?.os,
    user_agent: device?.user_agent,
    connection_type: device?.connection_type,
    language: device?.language,
    timezone: device?.timezone,
  };
}
```

#### 1.9 Public API Changes

```typescript
/**
 * Track page view (for manual SPA navigation)
 */
async trackPageView(url?: string): Promise<void> {
  await this.ensureInitialized();
  if (!this.sessionState) return;

  // Update scroll before navigation
  if (this.scrollTracker) {
    this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
  }

  const path = url || window.location.pathname;
  this.sessionState.addPageview(path);

  // Reset scroll tracking
  this.scrollTracker?.reset();

  // Debounced send
  this.scheduleDebouncedSend();

  // Persist state
  this.sessionState.persist();
}

/**
 * Track goal (immediate send)
 */
async trackGoal(data: GoalData): Promise<void> {
  await this.ensureInitialized();
  if (!this.sessionState) return;

  // Add goal to SessionState
  this.sessionState.addGoal(data.action, data.value, data.properties);

  // Cancel any pending debounced send
  if (this.sendDebounceTimeout) {
    clearTimeout(this.sendDebounceTimeout);
    this.sendDebounceTimeout = null;
  }

  // Immediate send for goals (critical for conversion timing)
  await this.sendPayload();

  // Persist state
  this.sessionState.persist();
}

/**
 * Track custom event - DEPRECATED, use trackGoal instead
 * Kept for backward compatibility but converts to goal
 */
async trackEvent(name: string, properties?: Record<string, string>): Promise<void> {
  console.warn('[Staminads] trackEvent is deprecated, use trackGoal instead');
  await this.trackGoal({ action: name, properties });
}
```

#### 1.10 Methods to Remove

```typescript
// REMOVE entirely:
private sendEvent(name: EventName, properties?: Record<string, string>): void
private onScrollMilestone(percent: number): void
private onTick(): void
private updateSession(): void
```

---

### 2. `sdk/src/types.ts`

#### 2.1 Remove Legacy Types

```typescript
// REMOVE
export type EventName = 'screen_view' | 'ping' | 'scroll' | 'goal';

export interface TrackEventPayload {
  // ... entire interface
}
```

#### 2.2 Simplified Types

```typescript
// KEEP (unchanged)
export interface StaminadsConfig { ... }
export interface InternalConfig { ... }
export interface Session { ... }
export interface DeviceInfo { ... }
export interface GoalData { ... }
export interface HeartbeatTier { ... }
export interface HeartbeatState { ... }
export interface SessionDebugInfo { ... }

// MODIFY SessionDebugInfo
export interface SessionDebugInfo {
  session: Session | null;
  config: InternalConfig | null;
  isTracking: boolean;
  actionsCount: number;      // NEW: from SessionState
  checkpoint: number;         // NEW: from SessionState
  currentPage: string | null; // NEW: from SessionState
}

// REMOVE
export interface QueuedPayload { ... }  // No longer needed
export type FocusState = ...;           // No longer needed
```

---

### 3. `sdk/src/transport/sender.ts`

#### 3.1 Remove Legacy Methods

```typescript
// REMOVE
send(payload: TrackEventPayload): void
sendWithBeacon(payload: TrackEventPayload): boolean
flushQueue(): void
getQueueLength(): number

// KEEP
sendSession(payload: SessionPayload): Promise<SendResult>
sendSessionBeacon(payload: SessionPayload): boolean
```

#### 3.2 Simplified Sender Class

```typescript
import type { SessionPayload, SendResult } from '../types/session-state';

export class Sender {
  private readonly endpoint: string;
  private readonly debug: boolean;

  constructor(endpoint: string, _storage: Storage, debug: boolean = false) {
    this.endpoint = endpoint;
    this.debug = debug;
  }

  /**
   * Send session payload via fetch
   */
  async sendSession(payload: SessionPayload): Promise<SendResult> {
    const url = `${this.endpoint}/api/track.session`;

    if (this.debug) {
      console.log('[Staminads] Sending session payload:', payload);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success === true,
        checkpoint: data.checkpoint,
      };
    } catch (error) {
      if (this.debug) {
        console.error('[Staminads] Send failed:', error);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send session payload via sendBeacon (for unload)
   */
  sendSessionBeacon(payload: SessionPayload): boolean {
    const url = `${this.endpoint}/api/track.session`;
    const body = JSON.stringify(payload);

    if (this.debug) {
      console.log('[Staminads] Sending session beacon:', payload);
    }

    try {
      return navigator.sendBeacon(url, body);
    } catch (error) {
      if (this.debug) {
        console.error('[Staminads] Beacon failed:', error);
      }
      return false;
    }
  }
}
```

---

### 4. Files to Delete

```
sdk/src/core/duration.ts
sdk/src/core/duration.test.ts
```

---

## Send Triggers

| Trigger | Timing | Method |
|---------|--------|--------|
| Initial pageview | Immediate | `sendPayload()` |
| SPA navigation | Debounced (100ms) | `scheduleDebouncedSend()` |
| Goal completion | Immediate | `sendPayload()` |
| Heartbeat/periodic | Per tier interval | `sendPayload()` |
| Page unload | Immediate | `sendSessionBeacon()` |
| Visibility hidden | Immediate | `sendSessionBeacon()` |

---

## Data Flow

```
User Action          SDK Method              SessionState              Server
─────────────────────────────────────────────────────────────────────────────
Page Load      →  initializeAsync()     →  addPageview()           →  POST /api/track.session
                                                                       (with attributes)

Navigation     →  onNavigation()        →  addPageview()           →  POST /api/track.session
                                           (finalizes previous)        (debounced 100ms)

Goal           →  trackGoal()           →  addGoal()               →  POST /api/track.session
                                                                       (immediate)

Heartbeat      →  sendPingEvent()       →  updateScroll()          →  POST /api/track.session
                                           buildPayload()

Unload         →  flushOnce()           →  finalizeForUnload()     →  sendBeacon
                                           buildPayload()
```

---

## Checklist

### SDK Core
- [ ] Update `sdk/src/sdk.ts`:
  - [ ] Add SessionState import
  - [ ] Update SDK_VERSION to '6.0.0'
  - [ ] Add sessionState property
  - [ ] Add sendDebounceTimeout property
  - [ ] Replace initializeAsync() implementation
  - [ ] Replace onNavigation() implementation
  - [ ] Replace onVisibilityChange implementation
  - [ ] Replace flushOnce() implementation
  - [ ] Replace sendPingEvent() implementation
  - [ ] Add scheduleDebouncedSend() method
  - [ ] Add sendPayload() method
  - [ ] Add buildAttributes() method
  - [ ] Update trackPageView() implementation
  - [ ] Update trackGoal() implementation
  - [ ] Deprecate trackEvent() method
  - [ ] Remove sendEvent() method
  - [ ] Remove onScrollMilestone() method
  - [ ] Remove onTick() method
  - [ ] Remove updateSession() method
  - [ ] Remove DurationTracker usage

### Types
- [ ] Update `sdk/src/types.ts`:
  - [ ] Remove EventName type
  - [ ] Remove TrackEventPayload interface
  - [ ] Remove QueuedPayload interface
  - [ ] Remove FocusState type
  - [ ] Update SessionDebugInfo interface

### Transport
- [ ] Update `sdk/src/transport/sender.ts`:
  - [ ] Remove send() method
  - [ ] Remove sendWithBeacon() method
  - [ ] Remove flushQueue() method
  - [ ] Remove getQueueLength() method
  - [ ] Remove queue-related code
  - [ ] Simplify constructor

### Cleanup
- [ ] Delete `sdk/src/core/duration.ts`
- [ ] Delete `sdk/src/core/duration.test.ts`
- [ ] Update `sdk/src/core/index.ts` (remove duration export)

### Tests
- [ ] Update existing tests for new API
- [ ] Add SDK integration tests for SessionState
- [ ] Remove duration tracker tests

### Build & Verify
- [ ] Run `npm test` - all tests pass
- [ ] Run `npm run build` - no errors
- [ ] Verify bundle size is acceptable

---

## Additional Public API Changes

### `getFocusDuration()` Implementation

The legacy implementation uses DurationTracker. In V3, calculate from SessionState:

```typescript
/**
 * Get focus duration in milliseconds
 * In V3, this is calculated from completed pageview durations + current page time
 */
async getFocusDuration(): Promise<number> {
  await this.ensureInitialized();
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

### `debug()` Method Updates

```typescript
// BEFORE
debug(): SessionDebugInfo {
  return {
    session: this.sessionManager?.getSession() || null,
    config: this.config,
    focusState: this.durationTracker?.getState() || 'FOCUSED',
    isTracking: this.isTracking,
    queueLength: this.sender?.getQueueLength() || 0,
  };
}

// AFTER
debug(): SessionDebugInfo {
  return {
    session: this.sessionManager?.getSession() || null,
    config: this.config,
    isTracking: this.isTracking,
    actionsCount: this.sessionState?.getActions().length || 0,
    checkpoint: this.sessionState?.getCheckpoint() || -1,
    currentPage: this.sessionState?.getCurrentPage()?.path || null,
  };
}
```

### Updated `SessionDebugInfo` Type

```typescript
// BEFORE
export interface SessionDebugInfo {
  session: Session | null;
  config: InternalConfig | null;
  focusState: FocusState;
  isTracking: boolean;
  queueLength: number;
}

// AFTER
export interface SessionDebugInfo {
  session: Session | null;
  config: InternalConfig | null;
  isTracking: boolean;
  actionsCount: number;
  checkpoint: number;
  currentPage: string | null;
}
```

---

## Test Files to Update

| File | Action | Description |
|------|--------|-------------|
| `sdk/src/transport/sender.test.ts` | Modify | Remove legacy send/queue tests |
| `sdk/src/core/duration.test.ts` | Delete | DurationTracker removed |
| `sdk/src/sdk.heartbeat.test.ts` | Modify | Update for sendPayload instead of sendEvent |
| `sdk/src/sdk.page-duration.test.ts` | Modify | Update for SessionState |
| `sdk/src/sdk.test.ts` | Modify | Update for new API |

---

## Notes on Removed Features

### Heartbeat Tier Metadata

The legacy heartbeat sends tier metadata (`tier`, `active_time`, `page_active_time`). In V3:

- **Not sent**: This metadata is no longer included in payloads
- **Reason**: Server calculates duration from pageview `entered_at`/`exited_at`
- **Impact**: Debugging info reduced, but analytics unchanged

### Event Queue

The legacy queue with retry logic is removed because:

1. SessionState persists to sessionStorage
2. On page reload, state is restored
3. Cumulative sends naturally retry failed data
4. Simpler code, smaller bundle

---

## Migration Notes

### Breaking Changes

1. **No more individual events**: The SDK no longer sends `screen_view`, `ping`, `scroll`, or `goal` events individually. Everything goes through `/api/track.session`.

2. **trackEvent() deprecated**: Use `trackGoal()` instead. `trackEvent()` is kept but logs a deprecation warning and converts to a goal.

3. **No offline queue**: The old event queue with retry logic is removed. SessionState persistence provides recovery on page reload.

4. **SDK version 6.0.0**: Major version bump indicates breaking change.

### Server Requirements

The server must have the `/api/track.session` endpoint implemented (Phase 3) before deploying SDK 6.0.0.

---

## Bundle Size Impact

| Component | Before | After | Change |
|-----------|--------|-------|--------|
| DurationTracker | ~2KB | 0 | -2KB |
| Event queue | ~3KB | 0 | -3KB |
| SessionState | 0 | ~3KB | +3KB |
| sendEvent logic | ~2KB | 0 | -2KB |
| **Net change** | | | **~-4KB** |

The refactoring should result in a smaller bundle due to removal of the event queue and simplified sending logic.
