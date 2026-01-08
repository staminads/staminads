/**
 * SessionState Integration Tests
 *
 * Tests for V3 session payload cumulative actions array.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionState, SessionStateConfig } from '../../src/core/session-state';
import type { PageviewAction, GoalAction } from '../../src/types/session-state';

describe('SessionState', () => {
  let sessionState: SessionState;
  const mockConfig: SessionStateConfig = {
    workspace_id: 'test-ws',
    session_id: 'sess-123',
    created_at: Date.now() - 10000,
  };

  let mockSessionStorage: ReturnType<typeof createMockStorage>;

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
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
      get length() {
        return Object.keys(store).length;
      },
      _store: store,
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    mockSessionStorage = createMockStorage();
    vi.stubGlobal('sessionStorage', mockSessionStorage);

    sessionState = new SessionState(mockConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

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

  describe('addPageview - navigation', () => {
    beforeEach(() => {
      sessionState.addPageview('/home');
      // Simulate time on page
      vi.advanceTimersByTime(5000);
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
      expect(currentPage?.scroll).toBe(0); // Reset for new page
    });

    it('increments page_number for each navigation', () => {
      sessionState.addPageview('/about'); // page 2
      sessionState.addPageview('/contact'); // page 3
      sessionState.addPageview('/pricing'); // page 4

      const actions = sessionState.getActions();
      expect(actions.map((a) => (a as PageviewAction).page_number)).toEqual([
        1, 2, 3,
      ]);

      expect(sessionState.getCurrentPage()?.page_number).toBe(4);
    });
  });

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
      expect(goals.every((g) => g.page_number === 1)).toBe(true);
    });
  });

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
      sessionState.updateScroll(50); // User scrolled up

      expect(sessionState.getCurrentPage()?.scroll).toBe(75); // Still 75
    });

    it('clamps scroll to 0-100 range', () => {
      sessionState.updateScroll(150);
      expect(sessionState.getCurrentPage()?.scroll).toBe(100);

      sessionState.updateScroll(-10);
      expect(sessionState.getCurrentPage()?.scroll).toBe(100); // Still 100 (max)
    });

    it('no-op if no currentPage', () => {
      const emptyState = new SessionState(mockConfig);
      expect(() => emptyState.updateScroll(50)).not.toThrow();
    });
  });

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

      // Actions are added in order:
      // 1. Goal added while on /home
      // 2. Navigation to /dashboard finalizes /home pageview
      expect(payload.actions).toHaveLength(2);
      expect(payload.actions[0].type).toBe('goal'); // signup goal added first
      expect(payload.actions[1].type).toBe('pageview'); // home pageview finalized on navigation
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

  describe('checkpoint', () => {
    it('applyCheckpoint updates checkpoint value', () => {
      sessionState.addPageview('/home');
      sessionState.addGoal('signup');
      sessionState.applyCheckpoint(1);

      expect(sessionState.getCheckpoint()).toBe(1);
    });

    it('applyCheckpoint only increases (never decreases)', () => {
      sessionState.applyCheckpoint(5);
      sessionState.applyCheckpoint(3); // Lower value, should be ignored

      expect(sessionState.getCheckpoint()).toBe(5);
    });

    it('payload includes checkpoint for server-side filtering', () => {
      // Cumulative payload approach:
      // - SDK always sends ALL actions (cumulative)
      // - Checkpoint tells server which actions to skip (index <= checkpoint)
      // - Server processes only actions with index > checkpoint

      sessionState.addPageview('/page1'); // Will become action 0
      sessionState.addPageview('/page2'); // action 0 finalized, becomes action[0]
      // At this point: actions = [page1], currentPage = page2

      // Server responds with checkpoint = 0 (acked action[0])
      sessionState.applyCheckpoint(0);

      sessionState.addPageview('/page3'); // page2 finalized, becomes action[1]
      // At this point: actions = [page1, page2], currentPage = page3

      const payload = sessionState.buildPayload({
        landing_page: 'https://example.com',
      });

      // Payload includes ALL actions (cumulative)
      expect(payload.actions).toHaveLength(2); // page1 + page2 (page3 is currentPage)

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

  describe('finalizeForUnload', () => {
    it('converts currentPage to action', () => {
      sessionState.addPageview('/article');
      vi.advanceTimersByTime(10000);
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

  describe('persistence', () => {
    const STORAGE_KEY = 'stm_session_state';

    it('persist saves state to sessionStorage', () => {
      sessionState.addPageview('/home');
      sessionState.addGoal('test');
      sessionState.applyCheckpoint(0);

      sessionState.persist();

      const stored = mockSessionStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.actions).toHaveLength(1); // Only goal, home not finalized
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
      mockSessionStorage.clear();

      const newState = new SessionState(mockConfig);
      expect(() => newState.restore()).not.toThrow();
      expect(newState.getActions()).toEqual([]);
    });

    it('restore handles corrupted storage gracefully', () => {
      mockSessionStorage.setItem(STORAGE_KEY, 'not-valid-json');

      const newState = new SessionState(mockConfig);
      expect(() => newState.restore()).not.toThrow();
      expect(newState.getActions()).toEqual([]);
    });

    it('restore validates session_id matches', () => {
      // Store state with actual data (goal in actions[])
      sessionState.addPageview('/home');
      sessionState.addGoal('test_goal'); // This adds to actions[]
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

  describe('MAX_ACTIONS limit', () => {
    const MAX_ACTIONS = 1000;

    it('warns when approaching MAX_ACTIONS limit (90%)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Add actions up to 89% (899 actions, should not warn yet)
      for (let i = 0; i < 899; i++) {
        sessionState.addGoal(`goal_${i}`);
      }

      // Should not warn at 89%
      // The warning happens at >= 90%, so 900 is the first to trigger
      consoleSpy.mockClear();

      // Add one more to reach exactly 90% threshold (900 actions)
      sessionState.addGoal('goal_900');

      // Should warn now (900 >= 1000 * 0.9)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Approaching MAX_ACTIONS limit'),
      );

      consoleSpy.mockRestore();
    });

    it('prevents adding actions beyond MAX_ACTIONS', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
        expect.stringContaining('MAX_ACTIONS'),
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
});
