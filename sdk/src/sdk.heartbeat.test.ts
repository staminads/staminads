import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaminadsSDK } from './sdk';

// Mock dependencies
vi.mock('./storage/storage', () => ({
  Storage: vi.fn().mockImplementation(() => ({
    getVisitorId: vi.fn(() => null),
    setVisitorId: vi.fn(),
    getSession: vi.fn(() => null),
    setSession: vi.fn(),
    getQueue: vi.fn(() => []),
    setQueue: vi.fn(),
    addToQueue: vi.fn(),
    removeFromQueue: vi.fn(),
  })),
  TabStorage: vi.fn().mockImplementation(() => ({
    getTabId: vi.fn(() => 'tab-123'),
    setTabId: vi.fn(),
    getDimensions: vi.fn(() => ({})),
    setDimensions: vi.fn(),
  })),
}));

vi.mock('./core/session', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    getOrCreateSession: vi.fn(),
    getSession: vi.fn(() => ({
      id: 'session-123',
      visitor_id: 'visitor-123',
      workspace_id: 'ws-123',
      created_at: Date.now(),
      updated_at: Date.now(),
      last_active_at: Date.now(),
      focus_duration_ms: 0,
      total_duration_ms: 0,
      referrer: null,
      landing_page: '/',
      utm: null,
      max_scroll_percent: 0,
      interaction_count: 0,
      sdk_version: '5.0.0',
      sequence: 0,
      dimensions: {},
    })),
    getSessionId: vi.fn(() => 'session-123'),
    getVisitorId: vi.fn(() => 'visitor-123'),
    getTabId: vi.fn(() => 'tab-123'),
    updateSession: vi.fn(),
    reset: vi.fn(),
    setDimension: vi.fn(),
    setDimensions: vi.fn(),
    getDimension: vi.fn(),
    clearDimensions: vi.fn(),
    getDimensionsPayload: vi.fn(() => ({})),
  })),
}));

vi.mock('./core/duration', () => ({
  DurationTracker: vi.fn().mockImplementation(() => ({
    setTickCallback: vi.fn(),
    setAccumulatedDuration: vi.fn(),
    startFocus: vi.fn(),
    pauseFocus: vi.fn(),
    resumeFocus: vi.fn(),
    hideFocus: vi.fn(),
    reset: vi.fn(),
    getFocusDurationMs: vi.fn(() => 0),
    getFocusDurationSeconds: vi.fn(() => 0),
    getState: vi.fn(() => 'FOCUSED'),
  })),
}));

vi.mock('./transport/sender', () => ({
  Sender: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
    flushQueue: vi.fn(),
    getQueueLength: vi.fn(() => 0),
  })),
}));

vi.mock('./detection/device', () => ({
  DeviceDetector: vi.fn().mockImplementation(() => ({
    detectWithClientHints: vi.fn(() =>
      Promise.resolve({
        device: 'desktop',
        screen_width: 1920,
        screen_height: 1080,
        viewport_width: 1920,
        viewport_height: 1080,
        browser: 'Chrome',
        browser_type: 'chromium',
        os: 'Windows',
        user_agent: 'test-ua',
        connection_type: 'wifi',
        timezone: 'UTC',
        language: 'en-US',
      })
    ),
  })),
}));

vi.mock('./events/scroll', () => ({
  ScrollTracker: vi.fn().mockImplementation(() => ({
    setMilestoneCallback: vi.fn(),
    start: vi.fn(),
    reset: vi.fn(),
    getMaxScrollPercent: vi.fn(() => 0),
  })),
}));

vi.mock('./events/navigation', () => ({
  NavigationTracker: vi.fn().mockImplementation(() => ({
    setNavigationCallback: vi.fn(),
    start: vi.fn(),
  })),
}));

vi.mock('./detection/bot', () => ({
  isBot: vi.fn(() => false),
}));

// Mock document.hidden and visibilityState
const mockVisibility = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', {
    value: hidden,
    configurable: true,
  });
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true,
  });
};

describe('Tiered Heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('tier transitions', () => {
    it('uses 10s interval for first 3 minutes (tier 0)', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      // Clear initial screen_view
      sendSpy.mockClear();

      // Advance 2 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);

      const pings = sendSpy.mock.calls.filter((c) => c[0] === 'ping');
      // ~12 pings in 2 min at 10s interval
      expect(pings.length).toBeGreaterThanOrEqual(11);
      expect(pings.length).toBeLessThanOrEqual(13);

      // Check tier metadata
      const lastPing = pings[pings.length - 1];
      expect(lastPing[1]?.tier).toBe('0');
    });

    it('switches to 20s interval after 3 minutes (tier 1)', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // Advance to 3:10 (past tier boundary)
      vi.advanceTimersByTime(3 * 60 * 1000 + 10000);
      const pingsAt3_10 = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      // Advance another 40 seconds (should be 2 pings at 20s)
      vi.advanceTimersByTime(40000);
      const pingsAt3_50 = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      const newPings = pingsAt3_50 - pingsAt3_10;
      expect(newPings).toBe(2);

      // Check tier metadata
      const lastPing = sendSpy.mock.calls.filter((c) => c[0] === 'ping').pop();
      expect(lastPing?.[1]?.tier).toBe('1');
    });

    it('switches to 30s interval after 5 minutes (tier 2)', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // Advance to 5:10
      vi.advanceTimersByTime(5 * 60 * 1000 + 10000);
      const pingsAt5_10 = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      // Advance 60 seconds (should be 2 pings at 30s)
      vi.advanceTimersByTime(60000);
      const pingsAt6_10 = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      const newPings = pingsAt6_10 - pingsAt5_10;
      expect(newPings).toBe(2);

      // Check tier metadata
      const lastPing = sendSpy.mock.calls.filter((c) => c[0] === 'ping').pop();
      expect(lastPing?.[1]?.tier).toBe('2');
    });

    it('stops heartbeat after 10 minutes', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // Advance to 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);
      const pingsAt10 = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      // Advance another 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      const pingsAt15 = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      // No new pings after max duration
      expect(pingsAt15).toBe(pingsAt10);
      expect((sdk as any).heartbeatState.maxDurationReached).toBe(true);
    });

    it('maintains correct ping count across all tiers', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // Run for full 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);

      const pings = sendSpy.mock.calls.filter((c) => c[0] === 'ping');

      // Expected pings:
      // Tier 0 (0-3 min): 3 min / 10s = 18 pings
      // Tier 1 (3-5 min): 2 min / 20s = 6 pings
      // Tier 2 (5-10 min): 5 min / 30s = 10 pings
      // Total: ~34 pings (may vary by 1-2 due to boundaries)
      expect(pings.length).toBeGreaterThanOrEqual(32);
      expect(pings.length).toBeLessThanOrEqual(36);
    });
  });

  describe('visibility changes', () => {
    it('pauses timer when tab hidden', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // 1 minute active
      vi.advanceTimersByTime(60000);
      const pingsBefore = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      // Hide tab
      mockVisibility(true);
      (sdk as any).onVisibilityChange();

      // 5 minutes pass while hidden (should NOT count)
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Show tab
      mockVisibility(false);
      (sdk as any).onVisibilityChange();

      // 1 more minute active
      vi.advanceTimersByTime(60000);
      const pingsAfter = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;

      // Should have ~6 more pings (1 min at 10s), still in tier 0
      const newPings = pingsAfter - pingsBefore;
      expect(newPings).toBeGreaterThanOrEqual(5);
      expect(newPings).toBeLessThanOrEqual(7);

      // Total active time should be ~2 min, still tier 0
      expect((sdk as any).heartbeatState.currentTierIndex).toBe(0);
    });

    it('does not restart heartbeat after max duration on visibility change', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      // Exhaust max duration
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect((sdk as any).heartbeatState.maxDurationReached).toBe(true);

      // Hide then show tab
      mockVisibility(true);
      (sdk as any).onVisibilityChange();
      mockVisibility(false);
      (sdk as any).onVisibilityChange();

      // Heartbeat should NOT restart
      expect((sdk as any).heartbeatTimeout).toBeNull();
      expect((sdk as any).heartbeatState.isActive).toBe(false);
    });

    it('handles rapid visibility changes without race conditions', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // Rapid toggle: visible -> hidden -> visible -> hidden -> visible
      // Each hidden transition triggers flushOnce() which sends a ping
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(50);
        mockVisibility(i % 2 === 0);
        (sdk as any).onVisibilityChange();
      }

      // End visible
      mockVisibility(false);
      (sdk as any).onVisibilityChange();

      // Advance 1 second
      vi.advanceTimersByTime(1000);

      // Pings come from:
      // - flushOnce calls when tab goes hidden (deduplicated per visibility change)
      // - This is expected behavior - we flush on hide
      const pings = sendSpy.mock.calls.filter((c) => c[0] === 'ping');
      // With 5 toggles, we have ~2-3 hidden transitions that trigger flushOnce
      expect(pings.length).toBeLessThanOrEqual(5);

      // State should be consistent - heartbeat should be active when visible
      expect((sdk as any).heartbeatState.isActive).toBe(true);
    });

    it('does not send ping when tab is hidden (race condition guard)', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // Schedule a ping
      vi.advanceTimersByTime(5000);

      // Hide tab just before ping fires
      mockVisibility(true);
      // Don't call onVisibilityChange - simulate race condition
      // where timeout fires before visibility handler

      // Advance to trigger scheduled timeout
      vi.advanceTimersByTime(5000);

      // Ping should NOT have been sent (shouldSendPing returns false)
      const pings = sendSpy.mock.calls.filter((c) => c[0] === 'ping');
      // May have 1 ping from before hide, but not after
      expect(pings.length).toBeLessThanOrEqual(1);
    });
  });

  describe('SPA navigation', () => {
    it('continues session timer on navigation by default', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
        resetHeartbeatOnNavigation: false,
      });

      // 4 minutes active (tier 1)
      vi.advanceTimersByTime(4 * 60 * 1000);
      const accumulatedBefore = (sdk as any).getTotalActiveMs();
      expect(accumulatedBefore).toBeGreaterThanOrEqual(4 * 60 * 1000 - 100);

      // Navigate
      (sdk as any).onNavigation('/new-page');

      // Session timer should continue (accumulatedActiveMs preserved)
      // But we need to check accumulated + current active time
      const totalAfter = (sdk as any).getTotalActiveMs();
      expect(totalAfter).toBeGreaterThanOrEqual(4 * 60 * 1000 - 100);

      // Page timer should reset
      expect((sdk as any).heartbeatState.pageActiveMs).toBe(0);
    });

    it('resets session timer on navigation when configured', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
        resetHeartbeatOnNavigation: true,
      });

      // 4 minutes active
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Navigate
      (sdk as any).onNavigation('/new-page');

      // Session timer should reset
      expect((sdk as any).heartbeatState.accumulatedActiveMs).toBe(0);
      expect((sdk as any).heartbeatState.maxDurationReached).toBe(false);
      expect((sdk as any).heartbeatState.currentTierIndex).toBe(0);
    });

    it('tracks page active time separately', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      sendSpy.mockClear();

      // 2 minutes on page A
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Navigate to page B
      (sdk as any).onNavigation('/page-b');

      // 1 minute on page B
      vi.advanceTimersByTime(60000);

      // Check last ping metadata
      const lastPing = sendSpy.mock.calls.filter((c) => c[0] === 'ping').pop();
      expect(lastPing?.[1]?.active_time).toBe('180'); // 3 min total
      expect(lastPing?.[1]?.page_active_time).toBe('60'); // 1 min on page B
    });
  });

  describe('manual control', () => {
    it('resume() resets timer and restarts from tier 0', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      // Exhaust max duration
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect((sdk as any).heartbeatState.maxDurationReached).toBe(true);
      expect((sdk as any).heartbeatTimeout).toBeNull();

      // Explicit resume
      await sdk.resume();

      // Should reset and restart
      expect((sdk as any).heartbeatState.maxDurationReached).toBe(false);
      expect((sdk as any).heartbeatState.accumulatedActiveMs).toBe(0);
      expect((sdk as any).heartbeatState.currentTierIndex).toBe(0);
      expect((sdk as any).heartbeatTimeout).not.toBeNull();
    });

    it('pause() accumulates time correctly', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      // 2 minutes active
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Pause
      await sdk.pause();

      // Check accumulated time
      const accumulated = (sdk as any).heartbeatState.accumulatedActiveMs;
      expect(accumulated).toBeGreaterThanOrEqual(2 * 60 * 1000 - 100);
      expect(accumulated).toBeLessThanOrEqual(2 * 60 * 1000 + 100);
    });
  });

  describe('custom tiers', () => {
    it('accepts custom tier configuration', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
        heartbeatTiers: [
          { after: 0, desktopInterval: 5000, mobileInterval: 5000 },
          { after: 30000, desktopInterval: 15000, mobileInterval: 15000 },
        ],
        heartbeatMaxDuration: 60000,
      });

      sendSpy.mockClear();

      // First 30 seconds: 5s interval = 6 pings
      vi.advanceTimersByTime(30000);
      const pingsAt30s = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;
      expect(pingsAt30s).toBe(6);

      // Next 30 seconds: 15s interval = 2 pings
      vi.advanceTimersByTime(30000);
      const pingsAt60s = sendSpy.mock.calls.filter((c) => c[0] === 'ping').length;
      expect(pingsAt60s).toBe(8);
    });

    it('validates and sorts tiers', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
        heartbeatTiers: [
          { after: 60000, desktopInterval: 20000, mobileInterval: 20000 },
          { after: 30000, desktopInterval: 15000, mobileInterval: 15000 },
          // Missing tier at 0 - should be added
        ],
      });

      const tiers = (sdk as any).config.heartbeatTiers;
      expect(tiers[0].after).toBe(0);
      expect(tiers[1].after).toBe(30000);
      expect(tiers[2].after).toBe(60000);
    });

    it('enforces minimum interval', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
        heartbeatTiers: [
          { after: 0, desktopInterval: 1000, mobileInterval: 1000 }, // Too short
        ],
      });

      const tiers = (sdk as any).config.heartbeatTiers;
      expect(tiers[0].desktopInterval).toBe(5000); // Minimum enforced
      expect(tiers[0].mobileInterval).toBe(5000);
    });
  });

  describe('unlimited mode', () => {
    it('runs indefinitely with heartbeatMaxDuration: 0', async () => {
      const sdk = new StaminadsSDK();
      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
        heartbeatMaxDuration: 0,
      });

      sendSpy.mockClear();

      // Run for 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      const pings = sendSpy.mock.calls.filter((c) => c[0] === 'ping');
      expect(pings.length).toBeGreaterThan(40); // Should keep going
      expect((sdk as any).heartbeatState.maxDurationReached).toBe(false);
    });
  });

  describe('drift compensation', () => {
    it('compensates for setTimeout drift', async () => {
      const sdk = new StaminadsSDK();

      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      // Simulate drift by checking lastPingTime progression
      vi.advanceTimersByTime(30000); // 3 pings at 10s

      const lastPingTime = (sdk as any).heartbeatState.lastPingTime;
      const expectedTime = Date.now();

      // lastPingTime should be close to current time (within tolerance)
      expect(Math.abs(lastPingTime - expectedTime)).toBeLessThan(100);
    });
  });

  describe('mobile detection', () => {
    it('uses mobile intervals when device is mobile', async () => {
      const sdk = new StaminadsSDK();

      // Set mobile before init
      (sdk as any).isMobileDevice = true;

      const sendSpy = vi.spyOn(sdk as any, 'sendEvent');

      // We need to manually initialize with mobile device
      // This test is limited by mocking - in real scenario device detection happens in init
      await sdk.init({
        workspace_id: 'test',
        endpoint: 'https://test.com',
      });

      // Force mobile device flag after init
      (sdk as any).isMobileDevice = true;
      // Restart heartbeat to use mobile interval
      (sdk as any).resetHeartbeatState();
      (sdk as any).startHeartbeat();

      sendSpy.mockClear();

      // 14 seconds should have 2 pings at 7s mobile interval
      vi.advanceTimersByTime(14000);

      const pings = sendSpy.mock.calls.filter((c) => c[0] === 'ping');
      expect(pings.length).toBe(2);
    });
  });
});
