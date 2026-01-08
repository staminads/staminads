/**
 * SDK Unit Tests - Page Duration Tracking
 * Tests for page_duration and previous_path functionality in v3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaminadsSDK } from './sdk';

// Mock all dependencies to avoid timer issues
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
    get: vi.fn(() => null),
    set: vi.fn(),
    remove: vi.fn(),
  })),
  TabStorage: vi.fn().mockImplementation(() => ({
    getTabId: vi.fn(() => 'tab-123'),
    setTabId: vi.fn(),
    getDimensions: vi.fn(() => ({})),
    setDimensions: vi.fn(),
    get: vi.fn(() => null),
    set: vi.fn(),
    remove: vi.fn(),
  })),
  STORAGE_KEYS: {
    VISITOR_ID: 'staminads_visitor_id',
    SESSION: 'staminads_session',
    PENDING_QUEUE: 'staminads_queue',
  },
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
      referrer: 'https://google.com',
      landing_page: 'https://example.com/home',
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
        os: 'MacOS',
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
    getMaxScrollPercent: vi.fn(() => 50),
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

// Helper to set up document visibility
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

describe('SDK Page Duration Tracking', () => {
  let sdk: StaminadsSDK;
  let sendEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);

    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/home',
        href: 'https://example.com/home',
        hostname: 'example.com',
        search: '',
        hash: '',
      },
    });

    sdk = new StaminadsSDK();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('onNavigation page duration capture', () => {
    it('captures previousPageDuration BEFORE resetting timer', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;

      // Simulate 30 seconds passing - only set pageStartTime (pageActiveMs=0 by default)
      sdkAny.heartbeatState.pageStartTime = Date.now() - 30000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;

      // Update location and trigger navigation
      window.location.pathname = '/about';
      sdkAny.onNavigation('https://example.com/about');

      // Check that screen_view was sent with page_duration
      const screenViewCalls = sendEventSpy.mock.calls.filter(
        (call) => call[0] === 'screen_view'
      );
      expect(screenViewCalls.length).toBe(1);

      const props = screenViewCalls[0][1];
      expect(props).toBeDefined();
      expect(props.page_duration).toBe('30');
    });

    it('sends screen_view with page_duration property', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      sdkAny.heartbeatState.pageStartTime = Date.now() - 15000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;

      window.location.pathname = '/products';
      sdkAny.onNavigation('https://example.com/products');

      const call = sendEventSpy.mock.calls.find((c) => c[0] === 'screen_view');
      expect(call).toBeDefined();
      expect(call![1].page_duration).toBe('15');
    });

    it('sends screen_view with previous_path property', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      // previousPath should be /home after init
      expect(sdkAny.previousPath).toBe('/home');

      window.location.pathname = '/contact';
      sdkAny.onNavigation('https://example.com/contact');

      const call = sendEventSpy.mock.calls.find((c) => c[0] === 'screen_view');
      expect(call).toBeDefined();
      expect(call![1].previous_path).toBe('/home');
    });

    it('resets page timer AFTER capturing duration', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;

      // First navigation: 20s on /home
      sdkAny.heartbeatState.pageStartTime = Date.now() - 20000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;
      window.location.pathname = '/page2';
      sdkAny.onNavigation('https://example.com/page2');

      let call = sendEventSpy.mock.calls.find((c) => c[0] === 'screen_view');
      expect(call![1].page_duration).toBe('20');
      expect(call![1].previous_path).toBe('/home');

      sendEventSpy.mockClear();

      // After navigation, pageActiveMs should be reset by resetPageActiveTime()
      // Simulate 10s on /page2
      sdkAny.heartbeatState.pageStartTime = Date.now() - 10000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;

      window.location.pathname = '/page3';
      sdkAny.onNavigation('https://example.com/page3');

      call = sendEventSpy.mock.calls.find((c) => c[0] === 'screen_view');
      expect(call![1].page_duration).toBe('10'); // Should be 10, not 30
      expect(call![1].previous_path).toBe('/page2');
    });

    it('updates previousPath to current path after navigation', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      expect(sdkAny.previousPath).toBe('/home');

      window.location.pathname = '/new-page';
      sdkAny.onNavigation('https://example.com/new-page');

      expect(sdkAny.previousPath).toBe('/new-page');
    });

    it('page_duration is undefined for initial screen_view (landing)', async () => {
      sendEventSpy = vi.spyOn(StaminadsSDK.prototype as any, 'sendEvent');

      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      // First call should be screen_view without page_duration
      const initialCall = sendEventSpy.mock.calls.find(
        (c) => c[0] === 'screen_view'
      );
      expect(initialCall).toBeDefined();
      // Initial screen_view should NOT have properties or have undefined page_duration
      expect(initialCall![1]).toBeUndefined();
    });
  });

  describe('flushOnce page duration', () => {
    it('includes page_duration in final ping event', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      // Simulate 25s on current page (pageActiveMs=0, active with pageStartTime)
      sdkAny.heartbeatState.pageStartTime = Date.now() - 25000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;

      sdkAny.flushOnce();

      const pingCall = sendEventSpy.mock.calls.find((c) => c[0] === 'ping');
      expect(pingCall).toBeDefined();
      expect(pingCall![1].page_duration).toBe('25');
    });

    it('page_duration reflects time on current page only', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;

      // Navigate after 10s to reset page timer
      window.location.pathname = '/second';
      sdkAny.onNavigation('https://example.com/second');

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      // Simulate 15s on second page (pageActiveMs=0, active with pageStartTime)
      sdkAny.heartbeatState.pageStartTime = Date.now() - 15000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;
      sdkAny.flushed = false;
      sdkAny.flushOnce();

      const pingCall = sendEventSpy.mock.calls.find((c) => c[0] === 'ping');
      expect(pingCall![1].page_duration).toBe('15');
    });

    it('only flushes once (idempotent)', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      sdkAny.heartbeatState.isActive = true;

      sdkAny.flushOnce();
      sdkAny.flushOnce();
      sdkAny.flushOnce();

      const pingCalls = sendEventSpy.mock.calls.filter((c) => c[0] === 'ping');
      expect(pingCalls.length).toBe(1);
    });
  });

  describe('sendEvent page duration handling', () => {
    it('converts page_duration from string property to number in payload', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');

      sdkAny.sendEvent('screen_view', {
        page_duration: '42',
        previous_path: '/test',
      });

      expect(senderSendSpy).toHaveBeenCalled();
      const payload = senderSendSpy.mock.calls[0][0];
      expect(payload.page_duration).toBe(42);
      expect(typeof payload.page_duration).toBe('number');
    });

    it('includes previous_path from properties', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');

      sdkAny.sendEvent('screen_view', {
        page_duration: '10',
        previous_path: '/original-page',
      });

      const payload = senderSendSpy.mock.calls[0][0];
      expect(payload.previous_path).toBe('/original-page');
    });

    it('page_duration is undefined when not provided', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');

      sdkAny.sendEvent('screen_view', {});

      const payload = senderSendSpy.mock.calls[0][0];
      expect(payload.page_duration).toBeUndefined();
    });

    it('previous_path is undefined when not provided', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');

      sdkAny.sendEvent('screen_view', {});

      const payload = senderSendSpy.mock.calls[0][0];
      expect(payload.previous_path).toBeUndefined();
    });
  });

  describe('heartbeat ping events', () => {
    it('heartbeat ping includes page_active_time as STRING property', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      sdkAny.heartbeatState.pageStartTime = Date.now() - 5000;
      sdkAny.heartbeatState.isActive = true;

      // Call sendPingEvent directly (heartbeat ping)
      sdkAny.sendPingEvent();

      const pingCall = sendEventSpy.mock.calls.find((c) => c[0] === 'ping');
      expect(pingCall).toBeDefined();
      expect(pingCall![1].page_active_time).toBeDefined();
      expect(typeof pingCall![1].page_active_time).toBe('string');
    });

    it('heartbeat ping includes tier property', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      sdkAny.heartbeatState.isActive = true;

      sdkAny.sendPingEvent();

      const pingCall = sendEventSpy.mock.calls.find((c) => c[0] === 'ping');
      expect(pingCall![1].tier).toBeDefined();
      expect(typeof pingCall![1].tier).toBe('string');
    });

    it('heartbeat ping includes active_time property', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
      sendEventSpy.mockClear();

      const sdkAny = sdk as any;
      sdkAny.heartbeatState.isActive = true;

      sdkAny.sendPingEvent();

      const pingCall = sendEventSpy.mock.calls.find((c) => c[0] === 'ping');
      expect(pingCall![1].active_time).toBeDefined();
      expect(typeof pingCall![1].active_time).toBe('string');
    });

    it('heartbeat ping does NOT include page_duration typed field', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');
      senderSendSpy.mockClear();

      sdkAny.heartbeatState.isActive = true;
      sdkAny.sendPingEvent();

      const payload = senderSendSpy.mock.calls[0][0];
      // Heartbeat pings should NOT have page_duration as typed field
      // (they use page_active_time string property instead)
      expect(payload.page_duration).toBeUndefined();
    });
  });

  describe('unload ping events', () => {
    it('unload ping includes page_duration as TYPED NUMBER field', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');
      senderSendSpy.mockClear();

      sdkAny.heartbeatState.pageStartTime = Date.now() - 20000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;
      sdkAny.flushOnce();

      const payload = senderSendSpy.mock.calls[0][0];
      expect(typeof payload.page_duration).toBe('number');
      expect(payload.page_duration).toBe(20);
    });

    it('unload ping does NOT include previous_path', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;
      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');
      senderSendSpy.mockClear();

      sdkAny.heartbeatState.isActive = true;
      sdkAny.flushOnce();

      const payload = senderSendSpy.mock.calls[0][0];
      // Unload ping should NOT have previous_path
      expect(payload.previous_path).toBeUndefined();
    });

    it('unload ping page_duration reflects time on current page', async () => {
      await sdk.init({
        workspace_id: 'test-ws',
        endpoint: 'https://api.example.com',
      });

      const sdkAny = sdk as any;

      // Navigate to final page
      window.location.pathname = '/final-page';
      sdkAny.onNavigation('https://example.com/final-page');

      const senderSendSpy = vi.spyOn(sdkAny.sender, 'send');
      senderSendSpy.mockClear();

      // Simulate 8s on final page (pageActiveMs=0, active with pageStartTime)
      sdkAny.heartbeatState.pageStartTime = Date.now() - 8000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;
      sdkAny.flushed = false;
      sdkAny.flushOnce();

      const payload = senderSendSpy.mock.calls[0][0];
      expect(payload.page_duration).toBe(8);
    });
  });
});

describe('Page Duration Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/start',
        href: 'https://example.com/start',
        hostname: 'example.com',
        search: '',
        hash: '',
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('handles rapid navigations (< 1s per page)', async () => {
    const sdk = new StaminadsSDK();
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
    sendEventSpy.mockClear();

    const sdkAny = sdk as any;
    const pages = ['/page1', '/page2', '/page3', '/page4'];

    for (let i = 0; i < pages.length; i++) {
      // Simulate 500ms on each page (pageActiveMs=0, active with pageStartTime)
      sdkAny.heartbeatState.pageStartTime = Date.now() - 500;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;

      window.location.pathname = pages[i];
      sdkAny.onNavigation(`https://example.com${pages[i]}`);
    }

    const screenViews = sendEventSpy.mock.calls.filter(
      (c) => c[0] === 'screen_view'
    );
    expect(screenViews.length).toBe(4);

    // Each should have 0s duration (rounded from 500ms)
    for (const call of screenViews) {
      const duration = parseInt(call[1].page_duration, 10);
      expect(duration).toBeLessThanOrEqual(1);
    }
  });

  it('handles navigation with 0ms duration', async () => {
    const sdk = new StaminadsSDK();
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
    sendEventSpy.mockClear();

    const sdkAny = sdk as any;
    // Simulate 0ms (navigate immediately)
    sdkAny.heartbeatState.pageStartTime = Date.now();
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;

    window.location.pathname = '/instant';
    sdkAny.onNavigation('https://example.com/instant');

    const call = sendEventSpy.mock.calls.find((c) => c[0] === 'screen_view');
    expect(call![1].page_duration).toBe('0');
  });

  it('handles very long page durations (> 30 min)', async () => {
    const sdk = new StaminadsSDK();
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
      heartbeatMaxDuration: 0, // Disable limit
    });

    const sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
    sendEventSpy.mockClear();

    const sdkAny = sdk as any;
    // Simulate 45 minutes (pageActiveMs=0, active with pageStartTime)
    const durationMs = 45 * 60 * 1000;
    sdkAny.heartbeatState.pageStartTime = Date.now() - durationMs;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;

    window.location.pathname = '/after-long-read';
    sdkAny.onNavigation('https://example.com/after-long-read');

    const call = sendEventSpy.mock.calls.find((c) => c[0] === 'screen_view');
    expect(parseInt(call![1].page_duration, 10)).toBeGreaterThanOrEqual(2700);
  });

  it('correctly tracks 5+ page deep sessions', async () => {
    const sdk = new StaminadsSDK();
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sendEventSpy = vi.spyOn(sdk as any, 'sendEvent');
    sendEventSpy.mockClear();

    const sdkAny = sdk as any;
    const pages = ['/p1', '/p2', '/p3', '/p4', '/p5', '/p6'];
    const durations = [5, 10, 3, 8, 12, 7];

    for (let i = 0; i < pages.length; i++) {
      // Set up duration for current page (pageActiveMs=0, active with pageStartTime)
      sdkAny.heartbeatState.pageStartTime = Date.now() - durations[i] * 1000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;

      window.location.pathname = pages[i];
      sdkAny.onNavigation(`https://example.com${pages[i]}`);
    }

    const screenViews = sendEventSpy.mock.calls.filter(
      (c) => c[0] === 'screen_view'
    );
    expect(screenViews.length).toBe(6);

    // Verify first navigation captured /start's duration
    expect(screenViews[0][1].previous_path).toBe('/start');
    expect(parseInt(screenViews[0][1].page_duration, 10)).toBe(5);

    // Verify last navigation captured /p5's duration
    expect(screenViews[5][1].previous_path).toBe('/p5');
    expect(parseInt(screenViews[5][1].page_duration, 10)).toBe(7);
  });
});
