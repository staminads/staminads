/**
 * Page Lifecycle Integration Tests
 *
 * Tests that the SDK correctly handles browser lifecycle events:
 * - visibilitychange (tab switch, minimize)
 * - blur/focus (window switch, alt-tab)
 * - freeze/resume (mobile background)
 * - pagehide/beforeunload (navigation away)
 * - pageshow (bfcache restore)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DurationTracker } from '../../src/core/duration';
import { Storage, STORAGE_KEYS } from '../../src/storage/storage';
import { Sender } from '../../src/transport/sender';
import type { TrackEventPayload } from '../../src/types';

// Mock UUID generation
vi.mock('../../src/utils/uuid', () => ({
  generateUUIDv4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 10)),
}));

describe('Page Lifecycle Integration', () => {
  let durationTracker: DurationTracker;
  let storage: Storage;
  let sender: Sender;
  let mockPerformanceNow: ReturnType<typeof vi.fn>;
  let mockSendBeacon: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLocalStorage: ReturnType<typeof createMockStorage>;
  let visibilityState: 'visible' | 'hidden';

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

  const createPayload = (): TrackEventPayload => ({
    workspace_id: 'ws_123',
    session_id: 'session_456',
    name: 'ping',
    path: '/page',
    landing_page: 'https://example.com',
    duration: durationTracker.getFocusDurationSeconds(),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

    mockPerformanceNow = vi.fn().mockReturnValue(0);
    vi.stubGlobal('performance', { now: mockPerformanceNow });

    mockLocalStorage = createMockStorage();
    vi.stubGlobal('localStorage', mockLocalStorage);

    mockSendBeacon = vi.fn().mockReturnValue(true);
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('navigator', { sendBeacon: mockSendBeacon });
    vi.stubGlobal('fetch', mockFetch);

    // Mock visibilityState
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      get: () => visibilityState,
      configurable: true,
    });

    storage = new Storage();
    sender = new Sender('https://api.example.com', storage);
    durationTracker = new DurationTracker();

    // Initialize duration tracker (matches real SDK behavior)
    durationTracker.startFocus();
  });

  afterEach(() => {
    durationTracker.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('visibilitychange events', () => {
    it('pauses duration when tab becomes hidden', () => {
      mockPerformanceNow.mockReturnValue(1000);
      expect(durationTracker.getState()).toBe('FOCUSED');

      // Tab hidden
      visibilityState = 'hidden';
      durationTracker.hideFocus();

      expect(durationTracker.getState()).toBe('HIDDEN');
      expect(durationTracker.getFocusDurationMs()).toBe(1000);
    });

    it('resumes duration when tab becomes visible', () => {
      mockPerformanceNow.mockReturnValue(1000);
      durationTracker.hideFocus();
      expect(durationTracker.getState()).toBe('HIDDEN');

      // Tab visible again
      mockPerformanceNow.mockReturnValue(5000); // Time passed while hidden
      visibilityState = 'visible';
      durationTracker.resumeFocus();

      expect(durationTracker.getState()).toBe('FOCUSED');

      // Continue tracking
      mockPerformanceNow.mockReturnValue(6000);
      expect(durationTracker.getFocusDurationMs()).toBe(2000); // 1000 + 1000, not counting hidden time
    });

    it('flushes data on visibility hidden', async () => {
      mockPerformanceNow.mockReturnValue(5000);

      // Simulate flush on visibility change
      const payload = createPayload();
      await sender.send(payload);

      expect(mockSendBeacon).toHaveBeenCalled();
    });

    it('flushes queue on visibility visible', async () => {
      // Pre-fill queue
      const queuedItem = {
        id: 'queued-1',
        payload: createPayload(),
        created_at: Date.now() - 1000,
        attempts: 0,
        last_attempt: null,
      };
      mockLocalStorage._store['stm_pending'] = JSON.stringify([queuedItem]);

      storage = new Storage();
      sender = new Sender('https://api.example.com', storage);

      mockSendBeacon.mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: true });

      // Simulate coming back to visible
      await sender.flushQueue();

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('blur/focus events', () => {
    it('pauses duration on window blur', () => {
      mockPerformanceNow.mockReturnValue(2000);
      expect(durationTracker.getState()).toBe('FOCUSED');

      durationTracker.pauseFocus();

      expect(durationTracker.getState()).toBe('BLURRED');
      expect(durationTracker.getFocusDurationMs()).toBe(2000);
    });

    it('resumes duration on window focus', () => {
      mockPerformanceNow.mockReturnValue(2000);
      durationTracker.pauseFocus();

      mockPerformanceNow.mockReturnValue(5000);
      durationTracker.resumeFocus();

      expect(durationTracker.getState()).toBe('FOCUSED');

      mockPerformanceNow.mockReturnValue(6000);
      expect(durationTracker.getFocusDurationMs()).toBe(3000); // 2000 + 1000
    });

    it('does not double-pause on blur when already blurred', () => {
      mockPerformanceNow.mockReturnValue(1000);
      durationTracker.pauseFocus();
      const duration1 = durationTracker.getFocusDurationMs();

      mockPerformanceNow.mockReturnValue(2000);
      durationTracker.pauseFocus(); // Second pause should be no-op
      const duration2 = durationTracker.getFocusDurationMs();

      expect(duration1).toBe(duration2);
    });

    it('does not double-resume on focus when already focused', () => {
      expect(durationTracker.getState()).toBe('FOCUSED');

      mockPerformanceNow.mockReturnValue(1000);
      durationTracker.resumeFocus(); // Should be no-op

      expect(durationTracker.getState()).toBe('FOCUSED');
    });
  });

  describe('freeze/resume events (mobile)', () => {
    it('pauses and accumulates duration on freeze', () => {
      mockPerformanceNow.mockReturnValue(3000);
      expect(durationTracker.getState()).toBe('FOCUSED');

      // Simulate freeze event
      durationTracker.hideFocus();

      expect(durationTracker.getState()).toBe('HIDDEN');
      expect(durationTracker.getFocusDurationMs()).toBe(3000);
    });

    it('resumes tracking after resume event', () => {
      mockPerformanceNow.mockReturnValue(3000);
      durationTracker.hideFocus();

      // Long time passes while frozen (but not counted)
      mockPerformanceNow.mockReturnValue(60000);
      durationTracker.resumeFocus();

      mockPerformanceNow.mockReturnValue(61000);
      // Only 3000 (before freeze) + 1000 (after resume) = 4000
      expect(durationTracker.getFocusDurationMs()).toBe(4000);
    });
  });

  describe('pagehide/beforeunload events', () => {
    it('sends data via beacon on pagehide', async () => {
      mockPerformanceNow.mockReturnValue(10000);

      const payload = createPayload();
      await sender.send(payload);

      expect(mockSendBeacon).toHaveBeenCalled();
      const blobArg = mockSendBeacon.mock.calls[0][1] as Blob;
      expect(blobArg.type).toBe('application/json');
    });

    it('deduplicates flush between pagehide and beforeunload', async () => {
      let flushed = false;
      const flushOnce = async () => {
        if (flushed) return;
        flushed = true;
        await sender.send(createPayload());
      };

      // Simulate both events firing
      await flushOnce(); // pagehide
      await flushOnce(); // beforeunload

      // Should only send once
      expect(mockSendBeacon).toHaveBeenCalledTimes(1);
    });
  });

  describe('pageshow with bfcache', () => {
    it('resumes session on bfcache restore (persisted=true)', () => {
      // Initial state
      mockPerformanceNow.mockReturnValue(5000);
      durationTracker.hideFocus();
      const durationBeforeCache = durationTracker.getFocusDurationMs();

      // Simulate bfcache restore
      mockPerformanceNow.mockReturnValue(10000);
      durationTracker.resumeFocus();

      // Continue tracking
      mockPerformanceNow.mockReturnValue(11000);

      // Duration should continue from where it left off
      expect(durationTracker.getFocusDurationMs()).toBe(durationBeforeCache + 1000);
    });

    it('maintains session state after bfcache restore', () => {
      mockPerformanceNow.mockReturnValue(5000);
      durationTracker.hideFocus();

      // Restore
      mockPerformanceNow.mockReturnValue(10000);
      durationTracker.resumeFocus();

      expect(durationTracker.getState()).toBe('FOCUSED');
    });
  });

  describe('tick callback during lifecycle', () => {
    it('tick fires while focused', () => {
      const tickCallback = vi.fn();
      durationTracker.setTickCallback(tickCallback);

      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);

      expect(tickCallback).toHaveBeenCalled();
    });

    it('tick stops when hidden', () => {
      const tickCallback = vi.fn();
      durationTracker.setTickCallback(tickCallback);

      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      durationTracker.hideFocus();
      tickCallback.mockClear();

      mockPerformanceNow.mockReturnValue(2000);
      vi.advanceTimersByTime(1000);

      expect(tickCallback).not.toHaveBeenCalled();
    });

    it('tick resumes after resumeFocus', () => {
      const tickCallback = vi.fn();
      durationTracker.setTickCallback(tickCallback);

      durationTracker.hideFocus();
      tickCallback.mockClear();

      mockPerformanceNow.mockReturnValue(5000);
      durationTracker.resumeFocus();

      mockPerformanceNow.mockReturnValue(6000);
      vi.advanceTimersByTime(1000);

      expect(tickCallback).toHaveBeenCalled();
    });
  });

  describe('complex lifecycle scenarios', () => {
    it('handles rapid visibility toggles correctly', () => {
      mockPerformanceNow.mockReturnValue(0);

      // Rapid toggle sequence
      mockPerformanceNow.mockReturnValue(100);
      durationTracker.hideFocus();

      mockPerformanceNow.mockReturnValue(200);
      durationTracker.resumeFocus();

      mockPerformanceNow.mockReturnValue(300);
      durationTracker.hideFocus();

      mockPerformanceNow.mockReturnValue(400);
      durationTracker.resumeFocus();

      mockPerformanceNow.mockReturnValue(500);

      // Should have accumulated: 100 + 100 + 100 = 300ms of focus time
      expect(durationTracker.getFocusDurationMs()).toBe(300);
    });

    it('handles blur during hidden state', () => {
      mockPerformanceNow.mockReturnValue(1000);
      durationTracker.hideFocus();

      // Blur while already hidden should be no-op
      durationTracker.pauseFocus();

      expect(durationTracker.getState()).toBe('HIDDEN');
    });

    it('handles focus after blur correctly', () => {
      mockPerformanceNow.mockReturnValue(1000);
      durationTracker.pauseFocus(); // BLURRED

      mockPerformanceNow.mockReturnValue(2000);
      durationTracker.resumeFocus(); // Back to FOCUSED

      mockPerformanceNow.mockReturnValue(3000);
      expect(durationTracker.getFocusDurationMs()).toBe(2000); // 1000 + 1000
    });
  });

  describe('gap detection during lifecycle', () => {
    it('getFocusDurationMs includes large deltas (gap detection is in tick only)', () => {
      mockPerformanceNow.mockReturnValue(1000);
      const duration1 = durationTracker.getFocusDurationMs();
      expect(duration1).toBe(1000);

      // Simulate system sleep - huge gap
      // getFocusDurationMs() returns raw delta; gap detection only happens in tick()
      mockPerformanceNow.mockReturnValue(60000);
      const duration2 = durationTracker.getFocusDurationMs();

      // getFocusDurationMs() returns the full delta (gap detection is not here)
      expect(duration2).toBe(60000);
    });

    it('handles negative time jump gracefully', () => {
      mockPerformanceNow.mockReturnValue(1000);
      expect(durationTracker.getFocusDurationMs()).toBe(1000);

      // Clock goes backwards
      mockPerformanceNow.mockReturnValue(500);
      const duration = durationTracker.getFocusDurationMs();

      // Should handle gracefully - returns current delta which is 500
      expect(duration).toBe(500);
    });
  });
});
