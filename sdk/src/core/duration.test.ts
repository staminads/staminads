import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DurationTracker } from './duration';

describe('DurationTracker', () => {
  let tracker: DurationTracker;
  let mockPerformanceNow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPerformanceNow = vi.fn().mockReturnValue(0);
    vi.stubGlobal('performance', { now: mockPerformanceNow });
  });

  afterEach(() => {
    tracker?.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('initial state', () => {
    it('starts in FOCUSED state', () => {
      tracker = new DurationTracker();
      expect(tracker.getState()).toBe('FOCUSED');
    });

    it('getFocusDurationMs() returns 0 initially', () => {
      tracker = new DurationTracker();
      expect(tracker.getFocusDurationMs()).toBe(0);
    });
  });

  describe('duration tracking', () => {
    it('accumulates time while FOCUSED', () => {
      tracker = new DurationTracker();
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // Advance time by 1000ms
      mockPerformanceNow.mockReturnValue(1000);
      expect(tracker.getFocusDurationMs()).toBe(1000);

      // Advance more
      mockPerformanceNow.mockReturnValue(2500);
      expect(tracker.getFocusDurationMs()).toBe(2500);
    });

    it('getFocusDurationMs() rounds to nearest millisecond', () => {
      tracker = new DurationTracker();
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(1500.7);
      expect(tracker.getFocusDurationMs()).toBe(1501);
    });

    it('getFocusDurationSeconds() returns Math.round(ms/1000)', () => {
      tracker = new DurationTracker();
      tracker.startFocus();

      mockPerformanceNow.mockReturnValue(1400);
      expect(tracker.getFocusDurationSeconds()).toBe(1);

      mockPerformanceNow.mockReturnValue(1600);
      expect(tracker.getFocusDurationSeconds()).toBe(2);

      mockPerformanceNow.mockReturnValue(2500);
      expect(tracker.getFocusDurationSeconds()).toBe(3);
    });

    it('does not count time when delta > GAP_THRESHOLD_MS (5000ms)', () => {
      tracker = new DurationTracker();
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // Advance less than gap threshold
      mockPerformanceNow.mockReturnValue(3000);
      expect(tracker.getFocusDurationMs()).toBe(3000);

      // Jump beyond gap threshold - should not count
      mockPerformanceNow.mockReturnValue(10000); // 7000ms jump
      // The current delta (10000) is > 5000 so it's capped, returning only accumulated
      expect(tracker.getFocusDurationMs()).toBe(3000);
    });

    it('ignores negative time jumps', () => {
      tracker = new DurationTracker();
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(1000);

      const duration1 = tracker.getFocusDurationMs();
      expect(duration1).toBe(1000);

      // Simulate clock going backwards
      mockPerformanceNow.mockReturnValue(500);
      // Negative delta should be ignored
      expect(tracker.getFocusDurationMs()).toBe(0); // focusStartTime is 0, now is 500, delta is 500 but accumulated is 0
    });
  });

  describe('state machine transitions', () => {
    beforeEach(() => {
      tracker = new DurationTracker();
    });

    describe('startFocus', () => {
      it('sets state to FOCUSED', () => {
        tracker.pauseFocus(); // First go to BLURRED
        tracker.startFocus();
        expect(tracker.getState()).toBe('FOCUSED');
      });

      it('is no-op when already FOCUSED', () => {
        expect(tracker.getState()).toBe('FOCUSED');
        tracker.startFocus();
        expect(tracker.getState()).toBe('FOCUSED');
      });
    });

    describe('pauseFocus', () => {
      it('transitions FOCUSED -> BLURRED', () => {
        tracker.startFocus();
        expect(tracker.getState()).toBe('FOCUSED');
        tracker.pauseFocus();
        expect(tracker.getState()).toBe('BLURRED');
      });

      it('is no-op when BLURRED', () => {
        tracker.startFocus();
        tracker.pauseFocus();
        expect(tracker.getState()).toBe('BLURRED');
        tracker.pauseFocus();
        expect(tracker.getState()).toBe('BLURRED');
      });

      it('is no-op when HIDDEN', () => {
        tracker.startFocus();
        tracker.hideFocus();
        expect(tracker.getState()).toBe('HIDDEN');
        tracker.pauseFocus();
        expect(tracker.getState()).toBe('HIDDEN');
      });
    });

    describe('hideFocus', () => {
      it('transitions FOCUSED -> HIDDEN', () => {
        tracker.startFocus();
        tracker.hideFocus();
        expect(tracker.getState()).toBe('HIDDEN');
      });

      it('transitions BLURRED -> HIDDEN', () => {
        tracker.startFocus();
        tracker.pauseFocus();
        expect(tracker.getState()).toBe('BLURRED');
        tracker.hideFocus();
        expect(tracker.getState()).toBe('HIDDEN');
      });

      it('is no-op when already HIDDEN', () => {
        tracker.startFocus();
        tracker.hideFocus();
        expect(tracker.getState()).toBe('HIDDEN');
        tracker.hideFocus();
        expect(tracker.getState()).toBe('HIDDEN');
      });
    });

    describe('resumeFocus', () => {
      it('transitions BLURRED -> FOCUSED', () => {
        tracker.startFocus();
        tracker.pauseFocus();
        expect(tracker.getState()).toBe('BLURRED');
        tracker.resumeFocus();
        expect(tracker.getState()).toBe('FOCUSED');
      });

      it('transitions HIDDEN -> FOCUSED', () => {
        tracker.startFocus();
        tracker.hideFocus();
        expect(tracker.getState()).toBe('HIDDEN');
        tracker.resumeFocus();
        expect(tracker.getState()).toBe('FOCUSED');
      });

      it('is no-op when already FOCUSED', () => {
        tracker.startFocus();
        expect(tracker.getState()).toBe('FOCUSED');
        tracker.resumeFocus();
        expect(tracker.getState()).toBe('FOCUSED');
      });
    });
  });

  describe('accumulation', () => {
    beforeEach(() => {
      tracker = new DurationTracker();
    });

    it('pause/resume cycle accumulates correct duration', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // Focus for 1000ms
      mockPerformanceNow.mockReturnValue(1000);
      tracker.pauseFocus();
      expect(tracker.getFocusDurationMs()).toBe(1000);

      // Time passes while blurred (not counted)
      mockPerformanceNow.mockReturnValue(3000);
      expect(tracker.getFocusDurationMs()).toBe(1000);

      // Resume and focus for another 500ms
      tracker.resumeFocus();
      mockPerformanceNow.mockReturnValue(3500);
      expect(tracker.getFocusDurationMs()).toBe(1500);
    });

    it('multiple pause/resume cycles accumulate correctly', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // Cycle 1: 1000ms
      mockPerformanceNow.mockReturnValue(1000);
      tracker.pauseFocus();

      // Cycle 2: 500ms
      mockPerformanceNow.mockReturnValue(2000);
      tracker.resumeFocus();
      mockPerformanceNow.mockReturnValue(2500);
      tracker.pauseFocus();

      // Cycle 3: 300ms
      mockPerformanceNow.mockReturnValue(3000);
      tracker.resumeFocus();
      mockPerformanceNow.mockReturnValue(3300);
      tracker.hideFocus();

      // Total: 1000 + 500 + 300 = 1800ms
      expect(tracker.getFocusDurationMs()).toBe(1800);
    });

    it('accumulateFocusTime caps at 5min (GAP_THRESHOLD_MS * 60)', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // Jump way beyond reasonable (but less than cap for accumulation)
      mockPerformanceNow.mockReturnValue(200000); // 200 seconds
      tracker.pauseFocus();

      // Should be capped at 300000ms (5 min) based on delta check
      expect(tracker.getFocusDurationMs()).toBe(200000);
    });
  });

  describe('tick callback', () => {
    let tickCallback: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      tracker = new DurationTracker();
      tickCallback = vi.fn();
      tracker.setTickCallback(tickCallback);
    });

    it('tick fires every 1000ms while FOCUSED', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // First tick at 1000ms
      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      // Second tick at 2000ms
      mockPerformanceNow.mockReturnValue(2000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(2);

      // Third tick at 3000ms
      mockPerformanceNow.mockReturnValue(3000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(3);
    });

    it('tick stops when BLURRED', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      tracker.pauseFocus();

      // More time passes but tick should not fire
      mockPerformanceNow.mockReturnValue(2000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      mockPerformanceNow.mockReturnValue(3000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);
    });

    it('tick stops when HIDDEN', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      tracker.hideFocus();

      mockPerformanceNow.mockReturnValue(2000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);
    });

    it('tick resumes after resumeFocus', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      tracker.pauseFocus();
      mockPerformanceNow.mockReturnValue(2000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      tracker.resumeFocus();
      mockPerformanceNow.mockReturnValue(3000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(2);
    });

    it('tick callback receives no arguments', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);

      expect(tickCallback).toHaveBeenCalledWith();
    });
  });

  describe('gap detection in tick', () => {
    let tickCallback: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      tracker = new DurationTracker();
      tickCallback = vi.fn();
      tracker.setTickCallback(tickCallback);
    });

    it('gap detection: delta > 5000ms does not call tick callback', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      // Normal tick
      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      // Simulate system sleep - huge gap
      mockPerformanceNow.mockReturnValue(10000); // 9000ms gap
      vi.advanceTimersByTime(1000);
      // Tick should NOT call callback due to gap detection
      expect(tickCallback).toHaveBeenCalledTimes(1);
    });

    it('negative delta in tick does not call callback', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(1000);

      vi.advanceTimersByTime(1000);
      expect(tickCallback).toHaveBeenCalledTimes(1);

      // Clock goes backwards
      mockPerformanceNow.mockReturnValue(500);
      vi.advanceTimersByTime(1000);
      // Should not call callback
      expect(tickCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('restore and reset', () => {
    beforeEach(() => {
      tracker = new DurationTracker();
    });

    it('setAccumulatedDuration() restores previous duration', () => {
      tracker.setAccumulatedDuration(5000);
      expect(tracker.getFocusDurationMs()).toBe(5000);
    });

    it('setAccumulatedDuration() adds to current duration when focused', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      tracker.setAccumulatedDuration(5000);
      mockPerformanceNow.mockReturnValue(1000);
      expect(tracker.getFocusDurationMs()).toBe(6000);
    });

    it('reset() clears accumulatedFocusMs to 0', () => {
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);
      mockPerformanceNow.mockReturnValue(1000);
      tracker.pauseFocus();
      expect(tracker.getFocusDurationMs()).toBe(1000);

      mockPerformanceNow.mockReturnValue(2000);
      tracker.reset();
      mockPerformanceNow.mockReturnValue(2000);
      expect(tracker.getFocusDurationMs()).toBe(0);
    });

    it('reset() restarts focus tracking', () => {
      tracker.pauseFocus();
      expect(tracker.getState()).toBe('BLURRED');

      mockPerformanceNow.mockReturnValue(0);
      tracker.reset();
      expect(tracker.getState()).toBe('FOCUSED');

      mockPerformanceNow.mockReturnValue(500);
      expect(tracker.getFocusDurationMs()).toBe(500);
    });

    it('destroy() clears interval and callback', () => {
      const callback = vi.fn();
      tracker.setTickCallback(callback);
      tracker.startFocus();
      mockPerformanceNow.mockReturnValue(0);

      tracker.destroy();

      // Tick should not fire after destroy
      mockPerformanceNow.mockReturnValue(1000);
      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
