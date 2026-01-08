/**
 * Page Duration Integration Tests
 *
 * Tests that page_duration and previous_path are correctly tracked
 * across multi-page sessions and various navigation types.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StaminadsSDK } from '../../src/sdk';
import type { TrackEventPayload } from '../../src/types';

// Mock only external dependencies, let internal SDK components work together
vi.mock('../../src/storage/storage', () => ({
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

vi.mock('../../src/core/session', () => ({
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
      landing_page: 'https://example.com/',
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

vi.mock('../../src/core/duration', () => ({
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

vi.mock('../../src/detection/device', () => ({
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

vi.mock('../../src/events/scroll', () => ({
  ScrollTracker: vi.fn().mockImplementation(() => ({
    setMilestoneCallback: vi.fn(),
    start: vi.fn(),
    reset: vi.fn(),
    getMaxScrollPercent: vi.fn(() => 0),
  })),
}));

vi.mock('../../src/events/navigation', () => ({
  NavigationTracker: vi.fn().mockImplementation(() => ({
    setNavigationCallback: vi.fn(),
    start: vi.fn(),
  })),
}));

vi.mock('../../src/detection/bot', () => ({
  isBot: vi.fn(() => false),
}));

// Mock the Sender to capture events
let capturedPayloads: TrackEventPayload[] = [];
vi.mock('../../src/transport/sender', () => ({
  Sender: vi.fn().mockImplementation(() => ({
    send: vi.fn((payload: TrackEventPayload) => {
      capturedPayloads.push(payload);
    }),
    flushQueue: vi.fn(),
    getQueueLength: vi.fn(() => 0),
  })),
}));

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

describe('Multi-page Session Duration Tracking', () => {
  let sdk: StaminadsSDK;

  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);
    capturedPayloads = [];

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/',
        href: 'https://example.com/',
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

  it('tracks correct duration for landing page when navigating away', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    // Clear the initial screen_view
    capturedPayloads = [];

    const sdkAny = sdk as any;

    // Simulate 30s on landing page
    sdkAny.heartbeatState.pageStartTime = Date.now() - 30000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;

    // Navigate to /about
    window.location.pathname = '/about';
    sdkAny.onNavigation('https://example.com/about');

    const navEvent = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(navEvent).toBeDefined();
    expect(navEvent!.page_duration).toBe(30);
    expect(navEvent!.previous_path).toBe('/');
    expect(navEvent!.path).toBe('/about');
  });

  it('tracks correct duration for second page when navigating to third', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sdkAny = sdk as any;

    // First navigation: / -> /about (20s on /)
    sdkAny.heartbeatState.pageStartTime = Date.now() - 20000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/about';
    sdkAny.onNavigation('https://example.com/about');

    capturedPayloads = [];

    // Second navigation: /about -> /contact (15s on /about)
    sdkAny.heartbeatState.pageStartTime = Date.now() - 15000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/contact';
    sdkAny.onNavigation('https://example.com/contact');

    const navEvent = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(navEvent).toBeDefined();
    expect(navEvent!.page_duration).toBe(15);
    expect(navEvent!.previous_path).toBe('/about');
    expect(navEvent!.path).toBe('/contact');
  });

  it('tracks correct duration for final page on unload', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sdkAny = sdk as any;

    // Navigate to /final
    window.location.pathname = '/final';
    sdkAny.onNavigation('https://example.com/final');

    capturedPayloads = [];

    // Simulate 25s on final page, then unload
    sdkAny.heartbeatState.pageStartTime = Date.now() - 25000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    sdkAny.flushed = false;
    sdkAny.flushOnce();

    const unloadPing = capturedPayloads.find((p) => p.name === 'ping');
    expect(unloadPing).toBeDefined();
    expect(unloadPing!.page_duration).toBe(25);
    expect(unloadPing!.path).toBe('/final');
    expect(unloadPing!.previous_path).toBeUndefined();
  });

  it('accumulates total session duration across pages', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // Page 1: 10s
    sdkAny.heartbeatState.pageStartTime = Date.now() - 10000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/page1';
    sdkAny.onNavigation('https://example.com/page1');

    // Page 2: 20s
    sdkAny.heartbeatState.pageStartTime = Date.now() - 20000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/page2';
    sdkAny.onNavigation('https://example.com/page2');

    // Page 3: 15s, then unload
    sdkAny.heartbeatState.pageStartTime = Date.now() - 15000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    sdkAny.flushed = false;
    sdkAny.flushOnce();

    // Verify individual page durations
    const screenViews = capturedPayloads.filter((p) => p.name === 'screen_view');
    const pings = capturedPayloads.filter((p) => p.name === 'ping');

    expect(screenViews[0].page_duration).toBe(10); // Landing -> page1
    expect(screenViews[1].page_duration).toBe(20); // page1 -> page2
    expect(pings[0].page_duration).toBe(15); // page2 unload

    // Total: 10 + 20 + 15 = 45s across 3 pages
    const totalPageDuration = [...screenViews, ...pings].reduce(
      (sum, event) => sum + (event.page_duration ?? 0),
      0
    );
    expect(totalPageDuration).toBe(45);
  });

  it('handles 5+ page deep sessions', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    const pages = ['/p1', '/p2', '/p3', '/p4', '/p5'];
    const durations = [5, 8, 12, 3, 7];

    // Navigate through all pages
    for (let i = 0; i < pages.length; i++) {
      sdkAny.heartbeatState.pageStartTime = Date.now() - durations[i] * 1000;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;
      window.location.pathname = pages[i];
      sdkAny.onNavigation(`https://example.com${pages[i]}`);
    }

    // Final unload
    sdkAny.heartbeatState.pageStartTime = Date.now() - 10000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    sdkAny.flushed = false;
    sdkAny.flushOnce();

    const screenViews = capturedPayloads.filter((p) => p.name === 'screen_view');
    expect(screenViews.length).toBe(5);

    // Verify each navigation captured the previous page's duration
    expect(screenViews[0].previous_path).toBe('/');
    expect(screenViews[0].page_duration).toBe(5);

    expect(screenViews[4].previous_path).toBe('/p4');
    expect(screenViews[4].page_duration).toBe(7);
  });
});

describe('Navigation Type Handling', () => {
  let sdk: StaminadsSDK;

  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);
    capturedPayloads = [];

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

    sdk = new StaminadsSDK();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('handles pushState navigation with correct duration', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // Simulate pushState navigation after 12s
    sdkAny.heartbeatState.pageStartTime = Date.now() - 12000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/pushed-page';
    sdkAny.onNavigation('https://example.com/pushed-page');

    const event = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(event!.page_duration).toBe(12);
    expect(event!.previous_path).toBe('/start');
  });

  it('handles popstate (back button) with correct duration', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sdkAny = sdk as any;

    // Navigate forward: /start -> /page2
    sdkAny.heartbeatState.pageStartTime = Date.now() - 10000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/page2';
    sdkAny.onNavigation('https://example.com/page2');

    capturedPayloads = [];

    // Navigate back (popstate): /page2 -> /start
    sdkAny.heartbeatState.pageStartTime = Date.now() - 8000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/start';
    sdkAny.onNavigation('https://example.com/start');

    const backEvent = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(backEvent!.page_duration).toBe(8);
    expect(backEvent!.previous_path).toBe('/page2');
    expect(backEvent!.path).toBe('/start');
  });

  it('handles hash change navigation', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // Simulate hash navigation after 5s
    sdkAny.heartbeatState.pageStartTime = Date.now() - 5000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/start';
    window.location.hash = '#section2';
    sdkAny.onNavigation('https://example.com/start#section2');

    const event = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(event!.page_duration).toBe(5);
    expect(event!.previous_path).toBe('/start');
  });

  it('handles replaceState navigation', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // Simulate replaceState navigation after 7s
    sdkAny.heartbeatState.pageStartTime = Date.now() - 7000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/replaced-page';
    sdkAny.onNavigation('https://example.com/replaced-page');

    const event = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(event!.page_duration).toBe(7);
    expect(event!.previous_path).toBe('/start');
  });

  it('handles mixed navigation types in sequence', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // pushState: /start -> /page1 (5s)
    sdkAny.heartbeatState.pageStartTime = Date.now() - 5000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/page1';
    sdkAny.onNavigation('https://example.com/page1');

    // popstate: /page1 -> /start (3s)
    sdkAny.heartbeatState.pageStartTime = Date.now() - 3000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/start';
    sdkAny.onNavigation('https://example.com/start');

    // pushState: /start -> /page2 (8s)
    sdkAny.heartbeatState.pageStartTime = Date.now() - 8000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/page2';
    sdkAny.onNavigation('https://example.com/page2');

    const screenViews = capturedPayloads.filter((p) => p.name === 'screen_view');
    expect(screenViews.length).toBe(3);

    expect(screenViews[0].page_duration).toBe(5);
    expect(screenViews[0].previous_path).toBe('/start');

    expect(screenViews[1].page_duration).toBe(3);
    expect(screenViews[1].previous_path).toBe('/page1');

    expect(screenViews[2].page_duration).toBe(8);
    expect(screenViews[2].previous_path).toBe('/start');
  });
});

describe('Edge Cases', () => {
  let sdk: StaminadsSDK;

  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);
    capturedPayloads = [];

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

  it('handles rapid navigations (< 1s per page)', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // Rapid fire: 4 pages in 2s total
    const pages = ['/a', '/b', '/c', '/d'];
    for (const page of pages) {
      sdkAny.heartbeatState.pageStartTime = Date.now() - 500;
      sdkAny.heartbeatState.pageActiveMs = 0;
      sdkAny.heartbeatState.isActive = true;
      window.location.pathname = page;
      sdkAny.onNavigation(`https://example.com${page}`);
    }

    const screenViews = capturedPayloads.filter((p) => p.name === 'screen_view');
    expect(screenViews.length).toBe(4);

    // All should have ~0s duration
    for (const event of screenViews) {
      expect(event.page_duration).toBeLessThanOrEqual(1);
    }
  });

  it('handles navigation with 0ms duration', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // Instant navigation
    sdkAny.heartbeatState.pageStartTime = Date.now();
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/instant';
    sdkAny.onNavigation('https://example.com/instant');

    const event = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(event!.page_duration).toBe(0);
  });

  it('handles very long page durations (> 30 min)', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // 45 minutes
    const longDuration = 45 * 60 * 1000;
    sdkAny.heartbeatState.pageStartTime = Date.now() - longDuration;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/after-long-read';
    sdkAny.onNavigation('https://example.com/after-long-read');

    const event = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(event!.page_duration).toBeGreaterThanOrEqual(2700); // 45 min in seconds
  });

  it('handles navigation during heartbeat ping', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sdkAny = sdk as any;

    // Trigger a heartbeat ping
    sdkAny.heartbeatState.isActive = true;
    sdkAny.sendPingEvent();

    capturedPayloads = [];

    // Now navigate
    sdkAny.heartbeatState.pageStartTime = Date.now() - 6000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/after-ping';
    sdkAny.onNavigation('https://example.com/after-ping');

    const navEvent = capturedPayloads.find((p) => p.name === 'screen_view');
    expect(navEvent).toBeDefined();
    expect(navEvent!.page_duration).toBe(6);
    expect(navEvent!.previous_path).toBe('/home');
  });
});

describe('Page Duration and Path Association', () => {
  let sdk: StaminadsSDK;

  beforeEach(() => {
    vi.useFakeTimers();
    mockVisibility(false);
    capturedPayloads = [];

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/landing',
        href: 'https://example.com/landing',
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

  it('correctly associates duration with previous_path, not current path', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    capturedPayloads = [];
    const sdkAny = sdk as any;

    // User spends 30s on /landing, then navigates to /products
    sdkAny.heartbeatState.pageStartTime = Date.now() - 30000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    window.location.pathname = '/products';
    sdkAny.onNavigation('https://example.com/products');

    const event = capturedPayloads.find((p) => p.name === 'screen_view');

    // The event should be for the NEW page (/products)
    // But page_duration and previous_path should reflect the OLD page (/landing)
    expect(event!.path).toBe('/products'); // New page
    expect(event!.previous_path).toBe('/landing'); // Old page
    expect(event!.page_duration).toBe(30); // Time spent on /landing
  });

  it('unload ping has current path duration (no previous_path)', async () => {
    await sdk.init({
      workspace_id: 'test-ws',
      endpoint: 'https://api.example.com',
    });

    const sdkAny = sdk as any;

    // Navigate to /final
    window.location.pathname = '/final';
    sdkAny.onNavigation('https://example.com/final');

    capturedPayloads = [];

    // Unload from /final after 20s
    sdkAny.heartbeatState.pageStartTime = Date.now() - 20000;
    sdkAny.heartbeatState.pageActiveMs = 0;
    sdkAny.heartbeatState.isActive = true;
    sdkAny.flushed = false;
    sdkAny.flushOnce();

    const ping = capturedPayloads.find((p) => p.name === 'ping');

    // Unload ping shows current page being left
    expect(ping!.path).toBe('/final');
    expect(ping!.page_duration).toBe(20);
    expect(ping!.previous_path).toBeUndefined(); // Not needed for unload
  });
});
