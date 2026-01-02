/**
 * Duration Accuracy E2E Tests
 *
 * Tests that duration tracking is accurate during focus/blur and visibility changes.
 */

import { test, expect } from './fixtures';

test.describe('Duration Accuracy', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('duration increases while page is focused', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial event
    await page.waitForTimeout(500);

    // Wait some time
    const startTime = Date.now();
    await page.waitForTimeout(3000);
    const elapsed = Date.now() - startTime;

    // Trigger a ping to capture duration
    await page.evaluate(() => Staminads.trackEvent('duration_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/duration_check');
    const events = await response.json();

    expect(events.length).toBe(1);

    // Duration should be close to elapsed time (within 500ms tolerance)
    const reportedDuration = events[0].payload.duration * 1000; // Convert to ms
    expect(reportedDuration).toBeGreaterThan(elapsed - 1000);
    expect(reportedDuration).toBeLessThan(elapsed + 1000);
  });

  test('duration pauses when page becomes hidden', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Let duration accumulate
    await page.waitForTimeout(2000);

    // Hide the page (simulate tab switch)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait while hidden (duration should not increase)
    await page.waitForTimeout(2000);

    // Track event with current duration
    await page.evaluate(() => Staminads.trackEvent('hidden_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/hidden_check');
    const events = await response.json();

    // Duration should be approximately 2000ms (not 4000ms)
    // Allow tolerance for processing time
    const duration = events[0].payload.duration * 1000;
    expect(duration).toBeLessThan(3500); // Should not include hidden time
  });

  test('duration resumes when page becomes visible', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Initial focus time
    await page.waitForTimeout(1000);

    // Hide page
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(1000);

    // Show page again
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // More focus time
    await page.waitForTimeout(1000);

    // Check duration
    await page.evaluate(() => Staminads.trackEvent('resume_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/resume_check');
    const events = await response.json();

    // Duration should be ~2000ms (1000 + 1000), not 3000ms
    const duration = events[0].payload.duration * 1000;
    expect(duration).toBeGreaterThan(1500);
    expect(duration).toBeLessThan(3000);
  });

  test('duration pauses on window blur', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Initial focus
    await page.waitForTimeout(1500);

    // Blur window
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });

    // Wait while blurred
    await page.waitForTimeout(1500);

    // Check duration
    await page.evaluate(() => Staminads.trackEvent('blur_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/blur_check');
    const events = await response.json();

    // Duration should be ~1500ms, not 3000ms
    const duration = events[0].payload.duration * 1000;
    expect(duration).toBeLessThan(2500);
  });

  test('duration resumes on window focus', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(1000);

    // Blur
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(1000);

    // Focus
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1000);

    await page.evaluate(() => Staminads.trackEvent('focus_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/focus_check');
    const events = await response.json();

    // Duration ~2000ms (1000 before blur + 1000 after focus)
    const duration = events[0].payload.duration * 1000;
    expect(duration).toBeGreaterThan(1500);
    expect(duration).toBeLessThan(3000);
  });

  test('duration handles rapid focus/blur correctly', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Rapid toggle
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(200);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(200);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }

    await page.evaluate(() => Staminads.trackEvent('rapid_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/rapid_check');
    const events = await response.json();

    // Duration should be approximately 1000ms (5 * 200ms focus time)
    // Plus some initial time
    const duration = events[0].payload.duration * 1000;
    expect(duration).toBeGreaterThan(500);
    expect(duration).toBeLessThan(3000);
  });

  test('ping events include accurate duration', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for heartbeat
    await page.waitForTimeout(11000);

    const response = await request.get('/api/test/events/ping');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);

    // Duration should be close to elapsed time
    const duration = events[0].payload.duration;
    expect(duration).toBeGreaterThan(9); // At least 9 seconds
    expect(duration).toBeLessThan(15); // Not more than 15 seconds
  });
});

// TypeScript declarations
declare global {
  interface Window {
    SDK_READY: Promise<void>;
    Staminads: {
      track: (name: string, data?: Record<string, unknown>) => void;
    };
  }
  const Staminads: Window['Staminads'];
}
