/**
 * Scroll tracking
 */

import { throttle } from '../utils/throttle';

export class ScrollTracker {
  private maxScrollPercent = 0;
  private onMilestone: ((percent: number) => void) | null = null;
  private lastMilestone = 0;
  private boundHandler: (() => void) | null = null;

  constructor() {
    this.boundHandler = throttle(() => this.handleScroll(), 100);
  }

  /**
   * Start tracking scroll
   */
  start(): void {
    if (this.boundHandler) {
      window.addEventListener('scroll', this.boundHandler, { passive: true });
    }
    // Initial calculation
    this.handleScroll();
  }

  /**
   * Stop tracking scroll
   */
  stop(): void {
    if (this.boundHandler) {
      window.removeEventListener('scroll', this.boundHandler);
    }
  }

  /**
   * Set milestone callback (25%, 50%, 75%, 100%)
   */
  setMilestoneCallback(callback: (percent: number) => void): void {
    this.onMilestone = callback;
  }

  /**
   * Get max scroll percentage
   */
  getMaxScrollPercent(): number {
    return this.maxScrollPercent;
  }

  /**
   * Handle scroll event
   */
  private handleScroll(): void {
    const scrollHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    const clientHeight = window.innerHeight;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // Guard against division by zero
    const scrollableHeight = scrollHeight - clientHeight;
    if (scrollableHeight <= 0) {
      this.maxScrollPercent = 100; // No scrolling needed
      return;
    }

    const scrollPercent = Math.round((scrollTop / scrollableHeight) * 100);
    const clampedPercent = Math.min(100, Math.max(0, scrollPercent));

    if (clampedPercent > this.maxScrollPercent) {
      this.maxScrollPercent = clampedPercent;

      // Check milestones
      this.checkMilestones(clampedPercent);
    }
  }

  /**
   * Check and trigger milestone callbacks
   */
  private checkMilestones(percent: number): void {
    if (!this.onMilestone) return;

    const milestones = [25, 50, 75, 100];

    for (const milestone of milestones) {
      if (percent >= milestone && this.lastMilestone < milestone) {
        this.lastMilestone = milestone;
        this.onMilestone(milestone);
      }
    }
  }

  /**
   * Reset scroll tracking
   */
  reset(): void {
    this.maxScrollPercent = 0;
    this.lastMilestone = 0;
  }
}
