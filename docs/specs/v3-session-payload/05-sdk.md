# Phase 5: SDK

**Status**: Ready for Implementation
**Estimated Effort**: 2 days
**Dependencies**: Phase 1-4 (all server-side changes must be complete)

## Overview

Transform the SDK from sending individual events to building a cumulative `actions[]` array that gets sent as a session payload. The SDK tracks completed pageviews and goals, manages checkpointing for efficient network usage, and ensures reliable delivery through multiple send triggers.

**Key changes from v4 SDK:**
- Replace individual `screen_view`/`ping` events with cumulative `SessionPayload`
- New `SessionState` class to manage `actions[]` array
- Goal completion triggers immediate payload send (preserves timing)
- Checkpoint-based delta sending for long sessions
- Single endpoint (`track.session`) instead of multiple (`track`, `track.batch`)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            StaminadsSDK (modified)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  - init() → creates SessionState                                             │
│  - trackPageView() → SessionState.addPageview()                              │
│  - trackGoal() → SessionState.addGoal() + immediate send                     │
│  - onVisibilityChange() → SessionState.flush()                               │
│  - onUnload() → SessionState.flushBeacon()                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SessionState (new class)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  State:                                                                      │
│    - actions: Action[]           // Cumulative array of completed actions    │
│    - currentPage: CurrentPage    // In-progress page (not finalized)         │
│    - checkpoint: number          // Last acknowledged action index           │
│    - attributesSent: boolean     // Track if attributes sent                 │
│                                                                              │
│  Methods:                                                                    │
│    - addPageview(path) → finalize previous, start new                        │
│    - addGoal(name, value, props) → add goal action                           │
│    - buildPayload() → SessionPayload for server                              │
│    - applyCheckpoint(n) → update checkpoint from server response             │
│    - persist() → save to sessionStorage                                      │
│    - restore() → load from sessionStorage                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Sender (modified)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  - sendSession(payload) → POST /api/track.session                            │
│  - sendSessionBeacon(payload) → sendBeacon /api/track.session                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Send Triggers

| Trigger | Timing | Method | Rationale |
|---------|--------|--------|-----------|
| Initial pageview | Immediate | fetch | Establish session on server ASAP |
| Navigation (SPA) | Debounced 100ms | fetch | Batch rapid navigations |
| Goal completion | **Immediate** | fetch | Time-sensitive for attribution |
| Periodic heartbeat | 30-60s | fetch | Keep session alive, update duration |
| Tab hidden | Immediate | sendBeacon | May not get another chance |
| Page unload | Immediate | sendBeacon | Last chance to send data |

### Payload Strategy

| Scenario | Payload Content | Checkpoint |
|----------|-----------------|------------|
| First send | All actions + attributes | -1 (none) |
| Subsequent send | All actions since checkpoint | Previous checkpoint |
| Server response | - | New checkpoint = actions.length |

### currentPage vs actions[]

- `currentPage`: The page user is currently viewing (duration/scroll updating)
- `actions[]`: Array of **completed** pageviews (user has left the page)
- On navigation: `currentPage` → finalized action → `actions[]`, new `currentPage`
- On unload: `currentPage` → finalized action → `actions[]`, then send

### Session Storage Persistence

```typescript
// Key: stm_session_state
{
  actions: Action[],
  currentPage: CurrentPage | null,
  checkpoint: number,
  attributesSent: boolean,
}
```

Persist on:
- Every action addition
- Every checkpoint update
- Page visibility change (hidden)

Restore on:
- Page reload (same session)
- Back-forward cache restore

## Type Definitions

### SDK Types

```typescript
// sdk/src/types/session-state.ts

export type ActionType = 'pageview' | 'goal';

export interface PageviewAction {
  type: 'pageview';
  path: string;
  page_number: number;
  duration: number;      // milliseconds
  scroll: number;        // max scroll percentage (0-100)
  entered_at: number;    // epoch ms
  exited_at: number;     // epoch ms
}

export interface GoalAction {
  type: 'goal';
  name: string;
  path: string;
  page_number: number;
  timestamp: number;     // epoch ms
  value?: number;
  properties?: Record<string, string>;
}

export type Action = PageviewAction | GoalAction;

export interface CurrentPage {
  path: string;
  page_number: number;
  entered_at: number;    // epoch ms
  scroll: number;        // current max scroll
}

export interface SessionPayload {
  workspace_id: string;
  session_id: string;
  actions: Action[];
  current_page?: CurrentPage;
  checkpoint?: number;
  attributes?: SessionAttributes;
  created_at: number;
  updated_at: number;
  sdk_version: string;
}

export interface SessionAttributes {
  referrer?: string;
  landing_page: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
  utm_id_from?: string;
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device?: string;
  browser?: string;
  browser_type?: string;
  os?: string;
  user_agent?: string;
  connection_type?: string;
  language?: string;
  timezone?: string;
}

export interface SessionStateSnapshot {
  actions: Action[];
  currentPage: CurrentPage | null;
  checkpoint: number;
  attributesSent: boolean;
}

export interface SendResult {
  success: boolean;
  checkpoint?: number;  // Server's acknowledged checkpoint
  error?: string;
}
```

## Test Specifications (TDD)

### Test Setup

```typescript
// sdk/src/core/__tests__/session-state.test.ts

import { SessionState } from '../session-state';
import { PageviewAction, GoalAction, SessionPayload } from '../../types/session-state';

describe('SessionState', () => {
  let sessionState: SessionState;
  const mockConfig = {
    workspace_id: 'test-ws',
    session_id: 'sess-123',
    created_at: Date.now() - 10000,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    // Clear sessionStorage
    sessionStorage.clear();
    sessionState = new SessionState(mockConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
    sessionStorage.clear();
  });
```

### Test 1: Initial state

```typescript
describe('initial state', () => {
  it('starts with empty actions array', () => {
    expect(sessionState.getActions()).toEqual([]);
  });

  it('starts with null currentPage', () => {
    expect(sessionState.getCurrentPage()).toBeNull();
  });

  it('starts with checkpoint -1 (no checkpoint)', () => {
    expect(sessionState.getCheckpoint()).toBe(-1);
  });

  it('starts with attributesSent false', () => {
    expect(sessionState.hasAttributesSent()).toBe(false);
  });
});
```

### Test 2: Add first pageview

```typescript
describe('addPageview - first page', () => {
  it('sets currentPage when no previous page', () => {
    sessionState.addPageview('/home');

    const currentPage = sessionState.getCurrentPage();
    expect(currentPage).not.toBeNull();
    expect(currentPage?.path).toBe('/home');
    expect(currentPage?.page_number).toBe(1);
    expect(currentPage?.scroll).toBe(0);
    expect(currentPage?.entered_at).toBeGreaterThan(0);
  });

  it('does not add to actions array (page not completed)', () => {
    sessionState.addPageview('/home');

    expect(sessionState.getActions()).toHaveLength(0);
  });
});
```

### Test 3: Navigation finalizes previous page

```typescript
describe('addPageview - navigation', () => {
  beforeEach(() => {
    sessionState.addPageview('/home');
    // Simulate time on page
    jest.advanceTimersByTime(5000);
    sessionState.updateScroll(75);
  });

  it('finalizes previous page into actions array', () => {
    sessionState.addPageview('/about');

    const actions = sessionState.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('pageview');

    const pageview = actions[0] as PageviewAction;
    expect(pageview.path).toBe('/home');
    expect(pageview.page_number).toBe(1);
    expect(pageview.scroll).toBe(75);
    expect(pageview.duration).toBeGreaterThanOrEqual(5000);
    expect(pageview.exited_at).toBeGreaterThan(pageview.entered_at);
  });

  it('sets new currentPage with incremented page_number', () => {
    sessionState.addPageview('/about');

    const currentPage = sessionState.getCurrentPage();
    expect(currentPage?.path).toBe('/about');
    expect(currentPage?.page_number).toBe(2);
    expect(currentPage?.scroll).toBe(0);  // Reset for new page
  });

  it('increments page_number for each navigation', () => {
    sessionState.addPageview('/about');   // page 2
    sessionState.addPageview('/contact'); // page 3
    sessionState.addPageview('/pricing'); // page 4

    const actions = sessionState.getActions();
    expect(actions.map((a: PageviewAction) => a.page_number)).toEqual([1, 2, 3]);

    expect(sessionState.getCurrentPage()?.page_number).toBe(4);
  });
});
```

### Test 4: Add goal action

```typescript
describe('addGoal', () => {
  beforeEach(() => {
    sessionState.addPageview('/checkout');
  });

  it('adds goal action to actions array', () => {
    sessionState.addGoal('purchase', 99.99);

    const actions = sessionState.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('goal');

    const goal = actions[0] as GoalAction;
    expect(goal.name).toBe('purchase');
    expect(goal.value).toBe(99.99);
    expect(goal.path).toBe('/checkout');
    expect(goal.page_number).toBe(1);
    expect(goal.timestamp).toBeGreaterThan(0);
  });

  it('adds goal with optional properties', () => {
    sessionState.addGoal('signup', undefined, { plan: 'premium' });

    const goal = sessionState.getActions()[0] as GoalAction;
    expect(goal.properties).toEqual({ plan: 'premium' });
    expect(goal.value).toBeUndefined();
  });

  it('goal does not finalize currentPage', () => {
    sessionState.addGoal('add_to_cart', 50);

    // currentPage should still be active
    expect(sessionState.getCurrentPage()?.path).toBe('/checkout');
    // Only goal in actions, no pageview
    expect(sessionState.getActions()[0].type).toBe('goal');
  });

  it('multiple goals on same page have same page_number', () => {
    sessionState.addGoal('view_product');
    sessionState.addGoal('add_to_cart', 50);
    sessionState.addGoal('begin_checkout');

    const goals = sessionState.getActions() as GoalAction[];
    expect(goals.every(g => g.page_number === 1)).toBe(true);
  });
});
```

### Test 5: Update scroll

```typescript
describe('updateScroll', () => {
  beforeEach(() => {
    sessionState.addPageview('/article');
  });

  it('updates currentPage scroll when higher', () => {
    sessionState.updateScroll(25);
    expect(sessionState.getCurrentPage()?.scroll).toBe(25);

    sessionState.updateScroll(50);
    expect(sessionState.getCurrentPage()?.scroll).toBe(50);

    sessionState.updateScroll(75);
    expect(sessionState.getCurrentPage()?.scroll).toBe(75);
  });

  it('does not decrease scroll (tracks max)', () => {
    sessionState.updateScroll(75);
    sessionState.updateScroll(50);  // User scrolled up

    expect(sessionState.getCurrentPage()?.scroll).toBe(75);  // Still 75
  });

  it('clamps scroll to 0-100 range', () => {
    sessionState.updateScroll(150);
    expect(sessionState.getCurrentPage()?.scroll).toBe(100);

    sessionState.updateScroll(-10);
    expect(sessionState.getCurrentPage()?.scroll).toBe(100);  // Still 100 (max)
  });

  it('no-op if no currentPage', () => {
    const emptyState = new SessionState(mockConfig);
    expect(() => emptyState.updateScroll(50)).not.toThrow();
  });
});
```

### Test 6: Build payload

```typescript
describe('buildPayload', () => {
  const mockAttributes = {
    landing_page: 'https://example.com/home',
    referrer: 'https://google.com',
    utm_source: 'google',
    device: 'desktop',
    browser: 'Chrome',
  };

  it('includes all actions in payload', () => {
    sessionState.addPageview('/home');
    sessionState.addGoal('signup');
    sessionState.addPageview('/dashboard');

    const payload = sessionState.buildPayload(mockAttributes);

    expect(payload.actions).toHaveLength(2);  // home pageview + signup goal
    expect(payload.actions[0].type).toBe('pageview');
    expect(payload.actions[1].type).toBe('goal');
  });

  it('includes current_page if present', () => {
    sessionState.addPageview('/current');
    sessionState.updateScroll(30);

    const payload = sessionState.buildPayload(mockAttributes);

    expect(payload.current_page).toBeDefined();
    expect(payload.current_page?.path).toBe('/current');
    expect(payload.current_page?.scroll).toBe(30);
  });

  it('includes attributes on first send only', () => {
    sessionState.addPageview('/home');

    // First payload - includes attributes
    const payload1 = sessionState.buildPayload(mockAttributes);
    expect(payload1.attributes).toBeDefined();
    expect(payload1.attributes?.landing_page).toBe('https://example.com/home');

    sessionState.markAttributesSent();

    // Second payload - no attributes
    const payload2 = sessionState.buildPayload(mockAttributes);
    expect(payload2.attributes).toBeUndefined();
  });

  it('includes checkpoint if set', () => {
    sessionState.addPageview('/home');
    sessionState.applyCheckpoint(0);

    const payload = sessionState.buildPayload(mockAttributes);

    expect(payload.checkpoint).toBe(0);
  });

  it('includes session metadata', () => {
    sessionState.addPageview('/test');

    const payload = sessionState.buildPayload(mockAttributes);

    expect(payload.workspace_id).toBe('test-ws');
    expect(payload.session_id).toBe('sess-123');
    expect(payload.created_at).toBe(mockConfig.created_at);
    expect(payload.updated_at).toBeGreaterThan(0);
    expect(payload.sdk_version).toBeDefined();
  });
});
```

### Test 7: Checkpoint management

```typescript
describe('checkpoint', () => {
  it('applyCheckpoint updates checkpoint value', () => {
    sessionState.addPageview('/home');
    sessionState.addGoal('signup');
    sessionState.applyCheckpoint(1);

    expect(sessionState.getCheckpoint()).toBe(1);
  });

  it('applyCheckpoint only increases (never decreases)', () => {
    sessionState.applyCheckpoint(5);
    sessionState.applyCheckpoint(3);  // Lower value, should be ignored

    expect(sessionState.getCheckpoint()).toBe(5);
  });

  it('payload includes checkpoint for server-side filtering', () => {
    // Cumulative payload approach:
    // - SDK always sends ALL actions (cumulative)
    // - Checkpoint tells server which actions to skip (index <= checkpoint)
    // - Server processes only actions with index > checkpoint

    sessionState.addPageview('/page1');   // Will become action 0
    sessionState.addPageview('/page2');   // action 0 finalized, becomes action[0]
    // At this point: actions = [page1], currentPage = page2

    // Server responds with checkpoint = 0 (acked action[0])
    sessionState.applyCheckpoint(0);

    sessionState.addPageview('/page3');   // page2 finalized, becomes action[1]
    // At this point: actions = [page1, page2], currentPage = page3

    const payload = sessionState.buildPayload({
      landing_page: 'https://example.com',
    });

    // Payload includes ALL actions (cumulative)
    expect(payload.actions).toHaveLength(2);  // page1 + page2 (page3 is currentPage)

    // Checkpoint tells server to skip actions[0] (already processed)
    expect(payload.checkpoint).toBe(0);

    // Server will only process actions[1] (page2)
  });

  it('no checkpoint in payload when none acknowledged', () => {
    sessionState.addPageview('/home');

    const payload = sessionState.buildPayload({
      landing_page: 'https://example.com',
    });

    // No checkpoint yet (first send)
    expect(payload.checkpoint).toBeUndefined();
  });
});
```

### Test 8: Finalize for unload

```typescript
describe('finalizeForUnload', () => {
  it('converts currentPage to action', () => {
    sessionState.addPageview('/article');
    jest.advanceTimersByTime(10000);
    sessionState.updateScroll(80);

    sessionState.finalizeForUnload();

    const actions = sessionState.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('pageview');

    const pageview = actions[0] as PageviewAction;
    expect(pageview.path).toBe('/article');
    expect(pageview.scroll).toBe(80);
    expect(pageview.duration).toBeGreaterThanOrEqual(10000);
  });

  it('clears currentPage after finalize', () => {
    sessionState.addPageview('/test');
    sessionState.finalizeForUnload();

    expect(sessionState.getCurrentPage()).toBeNull();
  });

  it('is idempotent (safe to call multiple times)', () => {
    sessionState.addPageview('/test');

    sessionState.finalizeForUnload();
    sessionState.finalizeForUnload();
    sessionState.finalizeForUnload();

    expect(sessionState.getActions()).toHaveLength(1);
  });

  it('no-op if no currentPage', () => {
    sessionState.finalizeForUnload();

    expect(sessionState.getActions()).toHaveLength(0);
  });
});
```

### Test 9: Persistence

```typescript
describe('persistence', () => {
  const STORAGE_KEY = 'stm_session_state';

  it('persist saves state to sessionStorage', () => {
    sessionState.addPageview('/home');
    sessionState.addGoal('test');
    sessionState.applyCheckpoint(0);

    sessionState.persist();

    const stored = sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.actions).toHaveLength(1);  // Only goal, home not finalized
    expect(parsed.checkpoint).toBe(0);
    expect(parsed.currentPage).toBeDefined();
  });

  it('restore loads state from sessionStorage', () => {
    // Setup initial state
    sessionState.addPageview('/home');
    sessionState.addGoal('signup');
    sessionState.applyCheckpoint(0);
    sessionState.persist();

    // Create new instance and restore
    const newState = new SessionState(mockConfig);
    newState.restore();

    expect(newState.getActions()).toHaveLength(1);
    expect(newState.getCheckpoint()).toBe(0);
    expect(newState.getCurrentPage()?.path).toBe('/home');
  });

  it('restore handles missing storage gracefully', () => {
    sessionStorage.clear();

    const newState = new SessionState(mockConfig);
    expect(() => newState.restore()).not.toThrow();
    expect(newState.getActions()).toEqual([]);
  });

  it('restore handles corrupted storage gracefully', () => {
    sessionStorage.setItem(STORAGE_KEY, 'not-valid-json');

    const newState = new SessionState(mockConfig);
    expect(() => newState.restore()).not.toThrow();
    expect(newState.getActions()).toEqual([]);
  });

  it('restore validates session_id matches', () => {
    // Store state with actual data (goal in actions[])
    sessionState.addPageview('/home');
    sessionState.addGoal('test_goal');  // This adds to actions[]
    sessionState.persist();

    // Create state for different session
    const differentSession = new SessionState({
      ...mockConfig,
      session_id: 'different-session',
    });
    differentSession.restore();

    // Should not restore state from different session
    expect(differentSession.getActions()).toEqual([]);
    expect(differentSession.getCurrentPage()).toBeNull();
  });
});
```

### Test 10: SDK integration - send triggers

```typescript
// sdk/src/__tests__/sdk-session-payload.test.ts

import { StaminadsSDK } from '../sdk';

describe('StaminadsSDK - Session Payload', () => {
  let sdk: StaminadsSDK;
  let mockSender: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSender = jest.fn().mockResolvedValue({ success: true, checkpoint: 0 });

    sdk = new StaminadsSDK();
    // Mock the sender
    (sdk as any).sender = { sendSession: mockSender, sendSessionBeacon: mockSender };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initial pageview', () => {
    it('sends payload immediately on first pageview', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      // Initial pageview triggers immediate send
      expect(mockSender).toHaveBeenCalledTimes(1);

      const payload = mockSender.mock.calls[0][0];
      expect(payload.actions).toHaveLength(0);  // First page not finalized yet
      expect(payload.current_page?.path).toBeDefined();
      expect(payload.attributes).toBeDefined();  // Attributes on first send
    });
  });

  describe('navigation send trigger', () => {
    it('sends payload on SPA navigation (debounced)', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      mockSender.mockClear();

      // Simulate navigation
      await sdk.trackPageView('/about');

      // Debounce delay
      jest.advanceTimersByTime(100);

      expect(mockSender).toHaveBeenCalledTimes(1);

      const payload = mockSender.mock.calls[0][0];
      expect(payload.actions).toHaveLength(1);  // Previous page finalized
      expect(payload.actions[0].type).toBe('pageview');
    });

    it('batches rapid navigations', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      mockSender.mockClear();

      // Rapid navigations
      await sdk.trackPageView('/page1');
      await sdk.trackPageView('/page2');
      await sdk.trackPageView('/page3');

      // Before debounce
      expect(mockSender).toHaveBeenCalledTimes(0);

      // After debounce
      jest.advanceTimersByTime(100);

      expect(mockSender).toHaveBeenCalledTimes(1);  // Single batched send

      const payload = mockSender.mock.calls[0][0];
      expect(payload.actions).toHaveLength(3);  // All previous pages
    });
  });

  describe('goal send trigger', () => {
    it('sends payload immediately on goal completion', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      mockSender.mockClear();

      // Goal triggers immediate send (no debounce)
      await sdk.trackGoal({ action: 'purchase', value: 99.99 });

      // Immediate, no timer advance needed
      expect(mockSender).toHaveBeenCalledTimes(1);

      const payload = mockSender.mock.calls[0][0];
      expect(payload.actions.some((a: any) => a.type === 'goal')).toBe(true);
    });

    it('cancels pending debounced send when goal triggers', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      mockSender.mockClear();

      // Start navigation (debounced)
      await sdk.trackPageView('/checkout');

      // Before debounce fires, goal triggers
      await sdk.trackGoal({ action: 'purchase' });

      // Goal sends immediately
      expect(mockSender).toHaveBeenCalledTimes(1);

      // Advance past debounce
      jest.advanceTimersByTime(100);

      // No additional send (debounce was cancelled)
      expect(mockSender).toHaveBeenCalledTimes(1);
    });
  });

  describe('periodic send trigger', () => {
    it('sends payload on heartbeat interval', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
        heartbeatInterval: 30000,  // 30 seconds
      });

      mockSender.mockClear();

      // Advance to heartbeat interval
      jest.advanceTimersByTime(30000);

      expect(mockSender).toHaveBeenCalledTimes(1);

      const payload = mockSender.mock.calls[0][0];
      expect(payload.current_page).toBeDefined();  // Updates current page state
    });
  });

  describe('unload send trigger', () => {
    it('uses sendBeacon on visibility hidden', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const beaconMock = jest.fn().mockReturnValue(true);
      (sdk as any).sender.sendSessionBeacon = beaconMock;

      // Simulate visibility change
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(beaconMock).toHaveBeenCalledTimes(1);

      const payload = beaconMock.mock.calls[0][0];
      // Current page should be finalized in unload payload
      expect(payload.actions.length).toBeGreaterThanOrEqual(0);
      expect(payload.current_page).toBeUndefined();  // Finalized into actions
    });

    it('finalizes currentPage before unload send', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      // Navigate to build up state
      await sdk.trackPageView('/article');
      jest.advanceTimersByTime(5000);

      const beaconMock = jest.fn().mockReturnValue(true);
      (sdk as any).sender.sendSessionBeacon = beaconMock;

      // Simulate page unload
      window.dispatchEvent(new Event('pagehide'));

      const payload = beaconMock.mock.calls[0][0];

      // Article page should be finalized into actions
      const articleAction = payload.actions.find(
        (a: any) => a.type === 'pageview' && a.path === '/article'
      );
      expect(articleAction).toBeDefined();
      expect(articleAction.duration).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('checkpoint handling', () => {
    it('updates checkpoint from server response', async () => {
      mockSender.mockResolvedValue({ success: true, checkpoint: 5 });

      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      await sdk.trackPageView('/page1');
      jest.advanceTimersByTime(100);

      // Verify checkpoint was updated
      const state = (sdk as any).sessionState;
      expect(state.getCheckpoint()).toBe(5);
    });

    it('includes checkpoint in subsequent payloads', async () => {
      mockSender
        .mockResolvedValueOnce({ success: true, checkpoint: 2 })
        .mockResolvedValueOnce({ success: true, checkpoint: 4 });

      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      // First navigation
      await sdk.trackPageView('/page1');
      jest.advanceTimersByTime(100);

      mockSender.mockClear();

      // Second navigation
      await sdk.trackPageView('/page2');
      jest.advanceTimersByTime(100);

      const payload = mockSender.mock.calls[0][0];
      expect(payload.checkpoint).toBe(2);  // From first response
    });
  });
});
```

### Test 11: Sender modifications

```typescript
// sdk/src/transport/__tests__/sender.test.ts

describe('Sender - Session Payload', () => {
  describe('sendSession', () => {
    it('sends POST to /api/track.session', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, checkpoint: 0 }),
      });
      global.fetch = fetchMock;

      const sender = new Sender('https://api.example.com');
      await sender.sendSession(mockPayload);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('returns checkpoint from response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, checkpoint: 42 }),
      });

      const sender = new Sender('https://api.example.com');
      const result = await sender.sendSession(mockPayload);

      expect(result.checkpoint).toBe(42);
    });

    it('handles server errors gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const sender = new Sender('https://api.example.com');
      const result = await sender.sendSession(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('handles network errors gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const sender = new Sender('https://api.example.com');
      const result = await sender.sendSession(mockPayload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('sendSessionBeacon', () => {
    it('uses navigator.sendBeacon', () => {
      const beaconMock = jest.fn().mockReturnValue(true);
      navigator.sendBeacon = beaconMock;

      const sender = new Sender('https://api.example.com');
      const result = sender.sendSessionBeacon(mockPayload);

      expect(beaconMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.any(String)
      );
      expect(result).toBe(true);
    });

    it('falls back to fetch keepalive if beacon fails', () => {
      navigator.sendBeacon = jest.fn().mockReturnValue(false);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock;

      const sender = new Sender('https://api.example.com');
      sender.sendSessionBeacon(mockPayload);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/api/track.session',
        expect.objectContaining({
          keepalive: true,
        })
      );
    });
  });
});
```

### Test 12: Back-forward cache restore

```typescript
describe('back-forward cache', () => {
  it('restores state on bfcache restore', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    // Build up some state
    await sdk.trackPageView('/page1');
    await sdk.trackGoal({ action: 'test' });

    // Persist state
    (sdk as any).sessionState.persist();

    // Simulate bfcache restore
    const event = new PageTransitionEvent('pageshow', { persisted: true });
    window.dispatchEvent(event);

    // State should be restored
    const state = (sdk as any).sessionState;
    expect(state.getActions().length).toBeGreaterThan(0);
  });

  it('resumes tracking on bfcache restore', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    mockSender.mockClear();

    // Simulate bfcache restore
    const event = new PageTransitionEvent('pageshow', { persisted: true });
    window.dispatchEvent(event);

    // Should send updated payload
    expect(mockSender).toHaveBeenCalled();
  });
});
```

### Test 13: Error handling

```typescript
describe('error handling', () => {
  it('preserves state when server returns error', async () => {
    mockSender.mockResolvedValue({ success: false, error: 'Server error' });

    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    await sdk.trackGoal({ action: 'purchase' });

    // State should be preserved (not cleared on error)
    const state = (sdk as any).sessionState;
    expect(state.getActions().some((a: any) => a.type === 'goal')).toBe(true);

    // Checkpoint should NOT be updated
    expect(state.getCheckpoint()).toBe(-1);
  });

  it('retries on next trigger after error', async () => {
    mockSender
      .mockResolvedValueOnce({ success: false, error: 'Server error' })
      .mockResolvedValueOnce({ success: true, checkpoint: 1 });

    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    mockSender.mockClear();

    // First send fails
    await sdk.trackGoal({ action: 'test1' });

    // Second send succeeds
    await sdk.trackGoal({ action: 'test2' });

    // Both goals should be in the second payload
    const lastPayload = mockSender.mock.calls[1][0];
    expect(lastPayload.actions.filter((a: any) => a.type === 'goal')).toHaveLength(2);
  });

  it('does not throw on send error', async () => {
    mockSender.mockRejectedValue(new Error('Network error'));

    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    // Should not throw
    await expect(sdk.trackGoal({ action: 'test' })).resolves.not.toThrow();
  });
});
```

### Test 14: ScrollTracker integration

```typescript
describe('ScrollTracker integration', () => {
  it('updates SessionState scroll from ScrollTracker on heartbeat', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    // Simulate scroll
    const scrollTracker = (sdk as any).scrollTracker;
    scrollTracker.updateScroll(75);

    mockSender.mockClear();

    // Trigger heartbeat
    jest.advanceTimersByTime(30000);

    const payload = mockSender.mock.calls[0][0];
    expect(payload.current_page?.scroll).toBe(75);
  });

  it('scroll resets on navigation', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    // Scroll on first page
    const scrollTracker = (sdk as any).scrollTracker;
    scrollTracker.updateScroll(90);

    // Navigate
    await sdk.trackPageView('/page2');

    // Scroll should reset for new page
    const state = (sdk as any).sessionState;
    expect(state.getCurrentPage()?.scroll).toBe(0);
  });

  it('captures final scroll in finalized pageview', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const scrollTracker = (sdk as any).scrollTracker;
    scrollTracker.updateScroll(85);

    // Update SessionState scroll before navigation
    const state = (sdk as any).sessionState;
    state.updateScroll(85);

    mockSender.mockClear();

    // Navigate (finalizes previous page)
    await sdk.trackPageView('/page2');
    jest.advanceTimersByTime(100);

    const payload = mockSender.mock.calls[0][0];
    const finalizedPage = payload.actions.find((a: any) => a.type === 'pageview');

    expect(finalizedPage?.scroll).toBe(85);
  });
});
```

### Test 15: Concurrent action safety

```typescript
describe('concurrent safety', () => {
  it('handles rapid goal additions without race conditions', async () => {
    sessionState.addPageview('/checkout');

    // Simulate rapid concurrent goals (synchronous in this case)
    sessionState.addGoal('add_to_cart', 10);
    sessionState.addGoal('add_to_cart', 20);
    sessionState.addGoal('add_to_cart', 30);

    const goals = sessionState.getActions().filter(a => a.type === 'goal');
    expect(goals).toHaveLength(3);

    // Each should have valid timestamp
    const timestamps = goals.map((g: GoalAction) => g.timestamp);
    expect(timestamps.every(t => t > 0)).toBe(true);
  });

  it('handles navigation during goal send without losing data', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    // Start a goal send (slow)
    mockSender.mockImplementation(() => new Promise(resolve =>
      setTimeout(() => resolve({ success: true, checkpoint: 1 }), 100)
    ));

    const goalPromise = sdk.trackGoal({ action: 'purchase' });

    // Navigate immediately
    await sdk.trackPageView('/thank-you');

    await goalPromise;

    // Both goal and navigation should be tracked
    const state = (sdk as any).sessionState;
    const actions = state.getActions();

    expect(actions.some((a: any) => a.type === 'goal')).toBe(true);
    // Navigation tracked (at least in currentPage or actions)
  });
});
```

### Test 16: MAX_ACTIONS limit

```typescript
describe('MAX_ACTIONS limit', () => {
  const MAX_ACTIONS = 1000;

  it('warns when approaching MAX_ACTIONS limit (90%)', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Add actions up to 89% (899 actions, should not warn)
    for (let i = 0; i < 899; i++) {
      sessionState.addGoal(`goal_${i}`);
    }

    // Should not warn at 89%
    expect(consoleSpy).not.toHaveBeenCalled();

    // Add one more to reach exactly 90% threshold (900 actions)
    sessionState.addGoal('goal_900');

    // Should warn now (900 >= 1000 * 0.9)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Approaching MAX_ACTIONS limit')
    );

    consoleSpy.mockRestore();
  });

  it('prevents adding actions beyond MAX_ACTIONS', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Add MAX_ACTIONS goals
    for (let i = 0; i < MAX_ACTIONS; i++) {
      sessionState.addGoal(`goal_${i}`);
    }

    expect(sessionState.getActions()).toHaveLength(MAX_ACTIONS);

    // Try to add one more - should return false
    const result = sessionState.addGoal('over_limit');

    expect(result).toBe(false);
    // Should still be MAX_ACTIONS (extra action rejected)
    expect(sessionState.getActions()).toHaveLength(MAX_ACTIONS);
    // Should warn about MAX_ACTIONS reached
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('MAX_ACTIONS')
    );

    consoleSpy.mockRestore();
  });

  it('pageview navigations are not blocked by MAX_ACTIONS', () => {
    // Fill up with goals
    for (let i = 0; i < MAX_ACTIONS; i++) {
      sessionState.addGoal(`goal_${i}`);
    }

    // Navigation should still work (triggers checkpoint/send)
    sessionState.addPageview('/important');

    // currentPage should be set
    expect(sessionState.getCurrentPage()?.path).toBe('/important');
  });

  it('addGoal returns true when under limit, false when at limit', () => {
    // Should return true when under limit
    expect(sessionState.addGoal('goal_1')).toBe(true);

    // Fill to MAX_ACTIONS - 1
    for (let i = 1; i < MAX_ACTIONS; i++) {
      sessionState.addGoal(`goal_${i}`);
    }

    // Should return false when at limit
    expect(sessionState.addGoal('over_limit')).toBe(false);
  });
});
```

## Implementation

### File: `sdk/src/core/session-state.ts`

```typescript
import type {
  Action,
  PageviewAction,
  GoalAction,
  CurrentPage,
  SessionPayload,
  SessionAttributes,
  SessionStateSnapshot,
} from '../types/session-state';

const STORAGE_KEY = 'stm_session_state';
const SDK_VERSION = '6.0.0';  // Major version bump for V3 payload
const MAX_ACTIONS = 1000;     // Match server limit from Phase 2

export interface SessionStateConfig {
  workspace_id: string;
  session_id: string;
  created_at: number;
}

export class SessionState {
  private actions: Action[] = [];
  private currentPage: CurrentPage | null = null;
  private checkpoint: number = -1;  // -1 means no checkpoint
  private attributesSent: boolean = false;

  private readonly workspaceId: string;
  private readonly sessionId: string;
  private readonly createdAt: number;

  constructor(config: SessionStateConfig) {
    this.workspaceId = config.workspace_id;
    this.sessionId = config.session_id;
    this.createdAt = config.created_at;
  }

  // === Getters ===

  getActions(): Action[] {
    return [...this.actions];
  }

  getCurrentPage(): CurrentPage | null {
    return this.currentPage ? { ...this.currentPage } : null;
  }

  getCheckpoint(): number {
    return this.checkpoint;
  }

  hasAttributesSent(): boolean {
    return this.attributesSent;
  }

  // === Page Tracking ===

  addPageview(path: string): void {
    const now = Date.now();

    // Finalize previous page if exists
    if (this.currentPage) {
      this.finalizeCurrentPage(now);
    }

    // Start new page
    const pageNumber = this.getNextPageNumber();
    this.currentPage = {
      path,
      page_number: pageNumber,
      entered_at: now,
      scroll: 0,
    };
  }

  updateScroll(scrollPercent: number): void {
    if (!this.currentPage) return;

    // Clamp to 0-100
    const clamped = Math.max(0, Math.min(100, scrollPercent));

    // Only update if higher (track max)
    if (clamped > this.currentPage.scroll) {
      this.currentPage.scroll = clamped;
    }
  }

  // === Goal Tracking ===

  addGoal(name: string, value?: number, properties?: Record<string, string>): boolean {
    // Check MAX_ACTIONS limit
    if (this.actions.length >= MAX_ACTIONS) {
      console.warn(`[SessionState] MAX_ACTIONS (${MAX_ACTIONS}) reached, goal not added`);
      return false;
    }

    const goal: GoalAction = {
      type: 'goal',
      name,
      path: this.currentPage?.path || '/',
      page_number: this.currentPage?.page_number || 1,
      timestamp: Date.now(),
    };

    if (value !== undefined) {
      goal.value = value;
    }

    if (properties) {
      goal.properties = properties;
    }

    this.actions.push(goal);

    // Warn if approaching limit
    if (this.actions.length >= MAX_ACTIONS * 0.9) {
      console.warn(`[SessionState] Approaching MAX_ACTIONS limit (${this.actions.length}/${MAX_ACTIONS})`);
    }

    return true;
  }

  // === Payload Building ===

  buildPayload(attributes: SessionAttributes): SessionPayload {
    const payload: SessionPayload = {
      workspace_id: this.workspaceId,
      session_id: this.sessionId,
      actions: [...this.actions],
      created_at: this.createdAt,
      updated_at: Date.now(),
      sdk_version: SDK_VERSION,
    };

    // Include current page if present
    if (this.currentPage) {
      payload.current_page = { ...this.currentPage };
    }

    // Include checkpoint if set
    if (this.checkpoint >= 0) {
      payload.checkpoint = this.checkpoint;
    }

    // Include attributes only on first send
    if (!this.attributesSent) {
      payload.attributes = attributes;
    }

    return payload;
  }

  // === Checkpoint Management ===

  applyCheckpoint(newCheckpoint: number): void {
    if (newCheckpoint > this.checkpoint) {
      this.checkpoint = newCheckpoint;
    }
  }

  markAttributesSent(): void {
    this.attributesSent = true;
  }

  // === Unload Handling ===

  finalizeForUnload(): void {
    if (!this.currentPage) return;

    this.finalizeCurrentPage(Date.now());
    this.currentPage = null;
  }

  // === Persistence ===

  persist(): void {
    try {
      const snapshot: SessionStateSnapshot = {
        actions: this.actions,
        currentPage: this.currentPage,
        checkpoint: this.checkpoint,
        attributesSent: this.attributesSent,
      };

      // Include session ID for validation on restore
      const data = {
        session_id: this.sessionId,
        ...snapshot,
      };

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // sessionStorage may be unavailable (private mode, quota exceeded)
      console.warn('[SessionState] Failed to persist:', e);
    }
  }

  restore(): void {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);

      // Validate session ID matches
      if (data.session_id !== this.sessionId) {
        // Different session, clear old data
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }

      // Restore state
      this.actions = data.actions || [];
      this.currentPage = data.currentPage || null;
      this.checkpoint = data.checkpoint ?? -1;
      this.attributesSent = data.attributesSent ?? false;
    } catch (e) {
      // Corrupted data, ignore
      console.warn('[SessionState] Failed to restore:', e);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  // === Private Helpers ===

  private finalizeCurrentPage(exitTime: number): void {
    if (!this.currentPage) return;

    const duration = exitTime - this.currentPage.entered_at;

    const pageview: PageviewAction = {
      type: 'pageview',
      path: this.currentPage.path,
      page_number: this.currentPage.page_number,
      duration,
      scroll: this.currentPage.scroll,
      entered_at: this.currentPage.entered_at,
      exited_at: exitTime,
    };

    this.actions.push(pageview);
  }

  private getNextPageNumber(): number {
    // Find highest page_number in actions
    let maxPageNumber = 0;

    for (const action of this.actions) {
      if (action.page_number > maxPageNumber) {
        maxPageNumber = action.page_number;
      }
    }

    // Current page would be next
    if (this.currentPage && this.currentPage.page_number > maxPageNumber) {
      maxPageNumber = this.currentPage.page_number;
    }

    return maxPageNumber + 1;
  }
}
```

### File: `sdk/src/transport/sender.ts` (modifications)

Add these methods to the existing Sender class:

```typescript
// In Sender class

/**
 * Send session payload via fetch
 */
async sendSession(payload: SessionPayload): Promise<SendResult> {
  const url = `${this.endpoint}/api/track.session`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      checkpoint: data.checkpoint,
    };
  } catch (error) {
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

  // Try sendBeacon first
  if (navigator.sendBeacon) {
    const success = navigator.sendBeacon(url, body);
    if (success) return true;
  }

  // Fallback to fetch with keepalive
  try {
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}
```

### File: `sdk/src/sdk.ts` (modifications)

Key changes to integrate SessionState:

```typescript
// Add import
import { SessionState, SessionStateConfig } from './core/session-state';

// In StaminadsSDK class, add:
private sessionState: SessionState | null = null;
private sendDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
private readonly SEND_DEBOUNCE_MS = 100;

// In initializeAsync, after session creation:
const sessionStateConfig: SessionStateConfig = {
  workspace_id: this.config.workspace_id,
  session_id: session.id,
  created_at: session.created_at,
};
this.sessionState = new SessionState(sessionStateConfig);
this.sessionState.restore();  // Restore from sessionStorage if available

// Initial pageview
this.sessionState.addPageview(window.location.pathname);

// Send initial payload (immediate)
await this.sendPayload(true);  // true = initial send

// Modify trackPageView:
async trackPageView(url?: string): Promise<void> {
  if (!this.sessionState) return;

  const path = url || window.location.pathname;
  this.sessionState.addPageview(path);

  // Debounced send
  this.scheduleDebouncedSend();

  // Persist state
  this.sessionState.persist();
}

// Modify trackGoal:
async trackGoal(data: GoalData): Promise<void> {
  if (!this.sessionState) return;

  this.sessionState.addGoal(data.action, data.value, data.properties);

  // Cancel any pending debounced send
  if (this.sendDebounceTimeout) {
    clearTimeout(this.sendDebounceTimeout);
    this.sendDebounceTimeout = null;
  }

  // Immediate send for goals
  await this.sendPayload();

  // Persist state
  this.sessionState.persist();
}

// Add helper methods:
private scheduleDebouncedSend(): void {
  if (this.sendDebounceTimeout) {
    clearTimeout(this.sendDebounceTimeout);
  }

  this.sendDebounceTimeout = setTimeout(async () => {
    this.sendDebounceTimeout = null;
    await this.sendPayload();
  }, this.SEND_DEBOUNCE_MS);
}

private async sendPayload(isInitial: boolean = false): Promise<void> {
  if (!this.sessionState || !this.sender) return;

  const attributes = this.buildAttributes();
  const payload = this.sessionState.buildPayload(attributes);

  const result = await this.sender.sendSession(payload);

  if (result.success) {
    if (isInitial || !this.sessionState.hasAttributesSent()) {
      this.sessionState.markAttributesSent();
    }

    if (result.checkpoint !== undefined) {
      this.sessionState.applyCheckpoint(result.checkpoint);
    }

    this.sessionState.persist();
  }
}

private buildAttributes(): SessionAttributes {
  // Build from existing session and device info
  const session = this.sessionManager?.get();
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

// Modify onVisibilityChange / onUnload:
private onUnload(): void {
  if (this.flushed) return;
  this.flushed = true;

  if (!this.sessionState || !this.sender) return;

  // Finalize current page
  this.sessionState.finalizeForUnload();

  // Build and send via beacon
  const attributes = this.buildAttributes();
  const payload = this.sessionState.buildPayload(attributes);

  this.sender.sendSessionBeacon(payload);

  // Persist final state
  this.sessionState.persist();
}

// Modify heartbeat to update scroll and send periodic payloads:
private sendPingEvent(): void {
  // Update scroll from ScrollTracker
  if (this.scrollTracker && this.sessionState) {
    this.sessionState.updateScroll(this.scrollTracker.getMaxScroll());
  }

  // Send periodic payload (non-blocking)
  this.sendPayload().catch(() => {});
}
```

## Configuration

### New Config Options

```typescript
// In StaminadsConfig
interface StaminadsConfig {
  // ... existing options ...

  /**
   * Debounce delay for navigation sends (ms)
   * Default: 100
   */
  navigationDebounce?: number;

  /**
   * Whether to use the new session payload format (v3)
   * Default: true (after rollout)
   */
  useSessionPayload?: boolean;
}
```

## Migration Strategy

### Phase A: Dual-mode (Optional)

If gradual rollout is needed:

1. Add `useSessionPayload: boolean` config option
2. Default to `false` initially
3. When `true`, use new SessionState + track.session endpoint
4. When `false`, use existing individual event tracking

### Phase B: Full Rollout

1. Remove dual-mode, always use SessionState
2. Remove old event tracking code
3. Update SDK version to 6.0.0

## Checklist

### Type Definitions
- [ ] Create `sdk/src/types/session-state.ts`:
  - [ ] ActionType, PageviewAction, GoalAction, Action
  - [ ] CurrentPage, SessionPayload, SessionAttributes
  - [ ] SessionStateSnapshot, SendResult

### SessionState Class
- [ ] Create `sdk/src/core/session-state.ts`:
  - [ ] Constructor with config
  - [ ] `addPageview(path)` - finalize previous, start new
  - [ ] `addGoal(name, value?, props?)` - add goal with MAX_ACTIONS check
  - [ ] `updateScroll(percent)` - track max scroll
  - [ ] `buildPayload(attributes)` - construct SessionPayload
  - [ ] `applyCheckpoint(n)` - update from server response
  - [ ] `markAttributesSent()` - track first-send
  - [ ] `finalizeForUnload()` - convert currentPage to action
  - [ ] `persist()` / `restore()` - sessionStorage

### Sender Modifications
- [ ] Modify `sdk/src/transport/sender.ts`:
  - [ ] Add `sendSession(payload): Promise<SendResult>`
  - [ ] Add `sendSessionBeacon(payload): boolean`
  - [ ] Use `/api/track.session` endpoint

### SDK Integration
- [ ] Modify `sdk/src/sdk.ts`:
  - [ ] Add `sessionState: SessionState` property
  - [ ] Initialize SessionState in `initializeAsync()`
  - [ ] Restore from sessionStorage on init
  - [ ] Modify `trackPageView()` → SessionState + debounced send
  - [ ] Modify `trackGoal()` → SessionState + immediate send
  - [ ] Add `scheduleDebouncedSend()` helper (100ms debounce)
  - [ ] Add `sendPayload()` helper
  - [ ] Add `buildAttributes()` helper
  - [ ] Modify `onUnload()` → finalize + beacon
  - [ ] Modify `onVisibilityChange()` → persist on hidden
  - [ ] Modify heartbeat → update scroll + periodic send
  - [ ] Handle checkpoint from server response
  - [ ] Integrate with ScrollTracker for scroll updates

### Tests
- [ ] Create `sdk/src/core/__tests__/session-state.test.ts`:
  - [ ] Test 1: Initial state
  - [ ] Test 2: Add first pageview
  - [ ] Test 3: Navigation finalizes previous page
  - [ ] Test 4: Add goal action
  - [ ] Test 5: Update scroll
  - [ ] Test 6: Build payload
  - [ ] Test 7: Checkpoint management
  - [ ] Test 8: Finalize for unload
  - [ ] Test 9: Persistence
  - [ ] Test 16: MAX_ACTIONS limit
- [ ] Create `sdk/src/__tests__/sdk-session-payload.test.ts`:
  - [ ] Test 10: Send triggers (initial, navigation, goal, periodic, unload)
  - [ ] Test 11: Sender methods
  - [ ] Test 12: Back-forward cache restore
  - [ ] Test 13: Error handling
  - [ ] Test 14: ScrollTracker integration
  - [ ] Test 15: Concurrent action safety

### Build & Verify
- [ ] Update `sdk/src/types.ts` to export new types
- [ ] Update SDK_VERSION to '6.0.0' in sdk.ts
- [ ] Run tests: `npm test`
- [ ] Build SDK: `npm run build`
- [ ] Verify bundle size is acceptable

### Browser Testing
- [ ] Initial pageview sends immediately with attributes
- [ ] Navigation debounces correctly (100ms)
- [ ] Rapid navigations batched into single send
- [ ] Goals send immediately (no debounce)
- [ ] Goals cancel pending debounced send
- [ ] Heartbeat sends periodic updates with scroll
- [ ] Unload finalizes currentPage and sends via beacon
- [ ] Page reload restores state from sessionStorage
- [ ] Back-forward cache restores state
- [ ] Checkpoint updates correctly from server response
- [ ] Attributes only sent on first payload
- [ ] MAX_ACTIONS limit enforced
- [ ] Error handling doesn't lose data
