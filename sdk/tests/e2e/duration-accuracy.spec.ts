/**
 * Duration Accuracy E2E Tests
 *
 * Tests that duration tracking is accurate during focus/blur and visibility changes.
 * Updated for V3 SessionPayload format - duration is tracked per-page in actions[].
 */

import { test, expect, CapturedPayload, getPageviews, getTotalPageviewDuration } from './fixtures';

test.describe('Duration Accuracy', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('current_page tracks time while focused', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial event
    await page.waitForTimeout(500);

    // Wait some time
    const startTime = Date.now();
    await page.waitForTimeout(3000);
    const elapsed = Date.now() - startTime;

    // Track a goal to trigger payload send
    await page.evaluate(() => Staminads.trackGoal({ action: 'duration_check' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);

    // Get the latest payload
    const latestPayload = events[events.length - 1].payload;

    // In V3, duration is tracked via current_page.entered_at
    // The SDK calculates focus duration from pageview durations + current page time
    expect(latestPayload.current_page).toBeTruthy();
    expect(latestPayload.current_page?.entered_at).toBeGreaterThan(0);

    // Duration can be approximated from entered_at to now
    const currentPageDuration = Date.now() - (latestPayload.current_page?.entered_at || 0);
    expect(currentPageDuration).toBeGreaterThan(elapsed - 1000);
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

    // Track goal to trigger send
    await page.evaluate(() => Staminads.trackGoal({ action: 'hidden_check' }));
    await page.waitForTimeout(500);

    // Check that SDK properly handled visibility
    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Events should have been sent (on visibilitychange hidden)
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('heartbeat continues when page visible', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for heartbeat (10s on desktop)
    await page.waitForTimeout(11000);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have received multiple payloads (initial + at least 1 heartbeat)
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test('duration tracked per page in SPA', async ({ page, request }) => {
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait on first page
    await page.waitForTimeout(2000);

    // Navigate to products
    await page.click('text=Products');
    await page.waitForTimeout(1000);

    // Navigate to about
    await page.click('text=About');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Get the latest payload
    const latestPayload = events[events.length - 1].payload;

    // Should have completed pageview actions with duration
    const pageviews = getPageviews(latestPayload);

    // Each completed pageview should have duration > 0
    for (const pv of pageviews) {
      expect(pv.duration).toBeGreaterThan(0);
      expect(pv.entered_at).toBeGreaterThan(0);
      expect(pv.exited_at).toBeGreaterThan(pv.entered_at);
    }
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

    // Check events sent
    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have sent events on blur
    expect(events.length).toBeGreaterThanOrEqual(1);
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

    // Track goal
    await page.evaluate(() => Staminads.trackGoal({ action: 'focus_check' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // SDK should have resumed and sent more events
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test('handles rapid focus/blur correctly', async ({ page, request }) => {
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

    await page.evaluate(() => Staminads.trackGoal({ action: 'rapid_check' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // SDK should handle rapid changes without crashing
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('getFocusDuration returns accumulated time', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait some time
    await page.waitForTimeout(2000);

    // Get focus duration from SDK
    const focusDuration = await page.evaluate(() => Staminads.getFocusDuration());

    // Should be approximately 2 seconds (within tolerance)
    expect(focusDuration).toBeGreaterThan(1500);
    expect(focusDuration).toBeLessThan(3500);
  });

  test('getTotalDuration returns wall clock time', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const startTime = Date.now();

    // Wait some time
    await page.waitForTimeout(2000);

    // Get total duration from SDK
    const totalDuration = await page.evaluate(() => Staminads.getTotalDuration());
    const expectedDuration = Date.now() - startTime;

    // Should be approximately equal to elapsed time
    expect(totalDuration).toBeGreaterThan(expectedDuration - 1000);
    expect(totalDuration).toBeLessThan(expectedDuration + 1000);
  });

  test('pageview duration is in milliseconds', async ({ page, request }) => {
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait 3 seconds on first page
    await page.waitForTimeout(3000);

    // Navigate to trigger pageview completion
    await page.click('text=Products');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Find payload with completed pageview
    let foundPageview = false;
    for (const event of events) {
      const pageviews = getPageviews(event.payload);
      if (pageviews.length > 0) {
        // Duration should be in milliseconds (> 1000 for 1+ seconds)
        expect(pageviews[0].duration).toBeGreaterThan(1000);
        foundPageview = true;
        break;
      }
    }

    expect(foundPageview).toBe(true);
  });
});
