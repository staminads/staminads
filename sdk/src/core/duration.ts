/**
 * Duration tracking with focus state machine
 * Handles precise millisecond tracking of active engagement time
 */

import type { FocusState } from '../types';

// Gap threshold for detecting system sleep/throttling
const GAP_THRESHOLD_MS = 5000;

export class DurationTracker {
  private focusStartTime: number | null = null;
  private accumulatedFocusMs = 0;
  private lastTickTime = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  // Start in BLURRED state so first startFocus() call works properly
  private state: FocusState = 'BLURRED';
  private onTick: (() => void) | null = null;
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Get current focus state
   */
  getState(): FocusState {
    return this.state;
  }

  /**
   * Set tick callback (called every second while focused)
   */
  setTickCallback(callback: () => void): void {
    this.onTick = callback;
  }

  /**
   * Start focus tracking
   */
  startFocus(): void {
    if (this.state === 'FOCUSED') return; // Already focused

    this.state = 'FOCUSED';
    this.focusStartTime = performance.now();
    this.lastTickTime = this.focusStartTime;
    this.startTicking();

    if (this.debug) {
      console.log('[Staminads] Focus started');
    }
  }

  /**
   * Pause focus tracking (blur event)
   */
  pauseFocus(): void {
    if (this.state === 'BLURRED' || this.state === 'HIDDEN') return;

    this.state = 'BLURRED';
    this.accumulateFocusTime();
    this.stopTicking();

    if (this.debug) {
      console.log('[Staminads] Focus paused (blur), accumulated:', this.accumulatedFocusMs);
    }
  }

  /**
   * Hide (visibility change to hidden)
   */
  hideFocus(): void {
    if (this.state === 'HIDDEN') return;

    this.state = 'HIDDEN';
    this.accumulateFocusTime();
    this.stopTicking();

    if (this.debug) {
      console.log('[Staminads] Focus hidden, accumulated:', this.accumulatedFocusMs);
    }
  }

  /**
   * Resume from paused/hidden state
   */
  resumeFocus(): void {
    if (this.state === 'FOCUSED') return;

    this.state = 'FOCUSED';
    this.focusStartTime = performance.now();
    this.lastTickTime = this.focusStartTime;
    this.startTicking();

    if (this.debug) {
      console.log('[Staminads] Focus resumed');
    }
  }

  /**
   * Get total focus duration in milliseconds
   */
  getFocusDurationMs(): number {
    let total = this.accumulatedFocusMs;

    if (this.focusStartTime !== null && this.state === 'FOCUSED') {
      const now = performance.now();
      const delta = now - this.focusStartTime;

      // Guard against negative time jumps only
      // (positive deltas are always valid - gap detection happens in tick())
      if (delta > 0) {
        total += delta;
      }
    }

    return Math.round(total);
  }

  /**
   * Get total focus duration in seconds
   */
  getFocusDurationSeconds(): number {
    return Math.round(this.getFocusDurationMs() / 1000);
  }

  /**
   * Reset duration tracking
   */
  reset(): void {
    this.accumulatedFocusMs = 0;
    this.focusStartTime = null;
    this.lastTickTime = 0;
    this.stopTicking();
    // Set to BLURRED so startFocus() will properly initialize
    this.state = 'BLURRED';
    this.startFocus();
  }

  /**
   * Set accumulated duration (for session restore)
   */
  setAccumulatedDuration(ms: number): void {
    this.accumulatedFocusMs = ms;
  }

  /**
   * Accumulate focus time
   */
  private accumulateFocusTime(): void {
    if (this.focusStartTime === null) return;

    const now = performance.now();
    const delta = now - this.focusStartTime;

    // Guard against negative time jumps or unrealistic forward jumps
    if (delta > 0 && delta < GAP_THRESHOLD_MS * 60) {
      // Max 5 minutes since last update
      this.accumulatedFocusMs += delta;
    }

    this.focusStartTime = null;
  }

  /**
   * Start tick interval
   */
  private startTicking(): void {
    if (this.tickInterval) return;

    this.tickInterval = setInterval(() => {
      this.tick();
    }, 1000);
  }

  /**
   * Stop tick interval
   */
  private stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Tick callback - called every second while focused
   */
  private tick(): void {
    if (this.focusStartTime === null || this.state !== 'FOCUSED') return;

    const now = performance.now();
    const delta = now - this.lastTickTime;
    this.lastTickTime = now;

    // Detect anomalies (system sleep, throttling)
    if (delta > GAP_THRESHOLD_MS) {
      if (this.debug) {
        console.warn(`[Staminads] Time gap detected: ${delta}ms - discarding`);
      }
      // Reset focus start to now (don't count gap time)
      this.focusStartTime = now;
      return;
    }

    // Detect negative time jumps
    if (delta < 0) {
      if (this.debug) {
        console.warn(`[Staminads] Negative time jump: ${delta}ms - resetting`);
      }
      this.focusStartTime = now;
      return;
    }

    // Call tick callback
    if (this.onTick) {
      this.onTick();
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopTicking();
    this.onTick = null;
  }
}
