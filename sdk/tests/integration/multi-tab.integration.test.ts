/**
 * Multi-tab Integration Tests
 *
 * Tests that multiple browser tabs share session/visitor data correctly
 * while maintaining independent tab IDs and duration tracking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage, TabStorage, STORAGE_KEYS } from '../../src/storage/storage';
import { SessionManager } from '../../src/core/session';
import { DurationTracker } from '../../src/core/duration';
import type { InternalConfig, Session } from '../../src/types';

// Mock UUID generation for predictable tests
vi.mock('../../src/utils/uuid', () => ({
  generateUUIDv4: vi.fn(() => 'mock-uuid-v4-' + Math.random().toString(36).slice(2, 10)),
  generateUUIDv7: vi.fn(() => 'mock-uuid-v7-' + Math.random().toString(36).slice(2, 10)),
}));

// Mock UTM parsing
vi.mock('../../src/utils/utm', () => ({
  parseUTMParams: vi.fn(() => ({
    source: null,
    medium: null,
    campaign: null,
    term: null,
    content: null,
    id: null,
    id_from: null,
  })),
  DEFAULT_AD_CLICK_IDS: ['gclid', 'fbclid'],
}));

describe('Multi-tab Integration', () => {
  const createMockStorage = () => {
    const store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(),
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
      get length() {
        return Object.keys(store).length;
      },
      _store: store,
    };
  };

  let sharedLocalStorage: ReturnType<typeof createMockStorage>;
  let config: InternalConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    // Shared localStorage (simulates cross-tab sharing)
    sharedLocalStorage = createMockStorage();
    vi.stubGlobal('localStorage', sharedLocalStorage);

    vi.stubGlobal('location', {
      href: 'https://example.com/page',
      pathname: '/page',
    });

    Object.defineProperty(document, 'referrer', {
      value: '',
      writable: true,
      configurable: true,
    });

    vi.stubGlobal('performance', { now: vi.fn().mockReturnValue(0) });

    config = {
      workspace_id: 'ws_123',
      endpoint: 'https://api.example.com',
      debug: false,
      sessionTimeout: 30 * 60 * 1000,
      heartbeatInterval: 10000,
      adClickIds: ['gclid', 'fbclid'],
      anonymizeIP: false,
      trackSPA: true,
      trackScroll: true,
      trackClicks: false,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /**
   * Simulates a browser tab with its own sessionStorage but shared localStorage
   */
  const createTab = () => {
    // Each tab has its own sessionStorage
    const tabSessionStorage = createMockStorage();
    vi.stubGlobal('sessionStorage', tabSessionStorage);

    const storage = new Storage();
    const tabStorage = new TabStorage();
    const sessionManager = new SessionManager(storage, tabStorage, config);
    const durationTracker = new DurationTracker();

    return {
      storage,
      tabStorage,
      sessionManager,
      durationTracker,
      sessionStorage: tabSessionStorage,
    };
  };

  describe('shared session across tabs', () => {
    it('two tabs share the same visitor_id via localStorage', () => {
      // Tab 1 creates session first
      const tab1 = createTab();
      const session1 = tab1.sessionManager.getOrCreateSession();

      // Tab 2 opens later - should get same visitor_id
      const tab2 = createTab();
      const session2 = tab2.sessionManager.getOrCreateSession();

      expect(session1.visitor_id).toBe(session2.visitor_id);
    });

    it('two tabs share the same session_id when session is valid', () => {
      // Tab 1 creates session
      const tab1 = createTab();
      const session1 = tab1.sessionManager.getOrCreateSession();

      // Advance time but stay within session timeout
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes

      // Tab 2 opens - should resume same session
      const tab2 = createTab();
      const session2 = tab2.sessionManager.getOrCreateSession();

      expect(session1.id).toBe(session2.id);
    });

    it('tab 2 creates new session when tab 1 session expired', () => {
      // Tab 1 creates session
      const tab1 = createTab();
      const session1 = tab1.sessionManager.getOrCreateSession();
      const originalSessionId = session1.id;

      // Advance time beyond session timeout
      vi.advanceTimersByTime(35 * 60 * 1000); // 35 minutes

      // Tab 2 opens - should create new session
      const tab2 = createTab();
      const session2 = tab2.sessionManager.getOrCreateSession();

      expect(session2.id).not.toBe(originalSessionId);
      // But visitor_id should still be shared
      expect(session2.visitor_id).toBe(session1.visitor_id);
    });
  });

  describe('unique tab_id per tab', () => {
    it('each tab has unique tab_id via sessionStorage', () => {
      const tab1 = createTab();
      tab1.sessionManager.getOrCreateSession();
      const tabId1 = tab1.sessionManager.getTabId();

      const tab2 = createTab();
      tab2.sessionManager.getOrCreateSession();
      const tabId2 = tab2.sessionManager.getTabId();

      expect(tabId1).not.toBe(tabId2);
    });

    it('tab_id persists within same tab session', () => {
      const tab1 = createTab();
      tab1.sessionManager.getOrCreateSession();
      const tabId1 = tab1.sessionManager.getTabId();
      const tabId2 = tab1.sessionManager.getTabId();

      expect(tabId1).toBe(tabId2);
    });

    it('tab_id is stored in sessionStorage not localStorage', () => {
      const tab = createTab();
      tab.sessionManager.getOrCreateSession();
      tab.sessionManager.getTabId();

      // tab_id should be in sessionStorage
      expect(tab.sessionStorage.setItem).toHaveBeenCalledWith(
        'stm_tab_id',
        expect.any(String)
      );

      // tab_id should NOT be in localStorage
      expect(sharedLocalStorage.setItem).not.toHaveBeenCalledWith(
        'stm_tab_id',
        expect.any(String)
      );
    });
  });

  describe('session updates visible across tabs', () => {
    it('session updates from tab A are visible when tab B resumes', () => {
      // Tab 1 creates and updates session
      const tab1 = createTab();
      const session1 = tab1.sessionManager.getOrCreateSession();
      tab1.sessionManager.updateSession({
        focus_duration_ms: 5000,
        max_scroll_percent: 50,
      });

      // Tab 2 opens and reads session
      const tab2 = createTab();
      const session2 = tab2.sessionManager.getOrCreateSession();

      // Tab 2 should see Tab 1's updates
      expect(session2.focus_duration_ms).toBe(5000);
      expect(session2.max_scroll_percent).toBe(50);
    });

    it('custom dimensions set in tab A are visible in tab B', () => {
      // Tab 1 sets dimensions
      const tab1 = createTab();
      tab1.sessionManager.getOrCreateSession();
      tab1.sessionManager.setDimension(1, 'premium');
      tab1.sessionManager.setDimension(2, 'campaign-A');

      // Tab 2 should see the dimensions
      const tab2 = createTab();
      tab2.sessionManager.getOrCreateSession();

      expect(tab2.sessionManager.getDimension(1)).toBe('premium');
      expect(tab2.sessionManager.getDimension(2)).toBe('campaign-A');
    });
  });

  describe('independent duration tracking per tab', () => {
    it('each tab tracks duration independently', () => {
      const mockPerformanceNow = vi.fn();
      vi.stubGlobal('performance', { now: mockPerformanceNow });

      // Tab 1 starts tracking
      mockPerformanceNow.mockReturnValue(0);
      const tab1 = createTab();
      tab1.durationTracker.reset();
      tab1.durationTracker.pauseFocus();
      tab1.durationTracker.resumeFocus();

      // Tab 1 accumulates 1000ms
      mockPerformanceNow.mockReturnValue(1000);
      const tab1Duration = tab1.durationTracker.getFocusDurationMs();

      // Tab 2 starts fresh
      mockPerformanceNow.mockReturnValue(0);
      const tab2 = createTab();
      tab2.durationTracker.reset();
      tab2.durationTracker.pauseFocus();
      tab2.durationTracker.resumeFocus();

      // Tab 2 accumulates 500ms
      mockPerformanceNow.mockReturnValue(500);
      const tab2Duration = tab2.durationTracker.getFocusDurationMs();

      expect(tab1Duration).toBe(1000);
      expect(tab2Duration).toBe(500);
    });

    it('pausing one tab does not affect another tab', () => {
      const mockPerformanceNow = vi.fn().mockReturnValue(0);
      vi.stubGlobal('performance', { now: mockPerformanceNow });

      const tab1 = createTab();
      tab1.durationTracker.reset();
      tab1.durationTracker.pauseFocus();
      tab1.durationTracker.resumeFocus();

      const tab2 = createTab();
      tab2.durationTracker.reset();
      tab2.durationTracker.pauseFocus();
      tab2.durationTracker.resumeFocus();

      // Pause tab 1
      mockPerformanceNow.mockReturnValue(1000);
      tab1.durationTracker.pauseFocus();

      // Tab 2 should still be tracking
      expect(tab1.durationTracker.getState()).toBe('BLURRED');
      expect(tab2.durationTracker.getState()).toBe('FOCUSED');
    });
  });

  describe('sequence number handling', () => {
    it('sequence increments when tab resumes session', () => {
      // Tab 1 creates session with sequence 0
      const tab1 = createTab();
      const session1 = tab1.sessionManager.getOrCreateSession();
      expect(session1.sequence).toBe(0);

      // Tab 2 resumes - sequence should increment
      const tab2 = createTab();
      const session2 = tab2.sessionManager.getOrCreateSession();
      expect(session2.sequence).toBe(1);

      // Tab 3 resumes - sequence should increment again
      const tab3 = createTab();
      const session3 = tab3.sessionManager.getOrCreateSession();
      expect(session3.sequence).toBe(2);
    });
  });
});
