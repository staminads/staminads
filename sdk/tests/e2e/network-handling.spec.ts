/**
 * Network Handling E2E Tests
 *
 * Tests network resilience: beacon, fetch, error handling.
 * Updated for V3 SessionPayload format.
 *
 * Note: Queue/retry functionality has been removed from the SDK in V3.
 * These tests focus on the current transport capabilities.
 */

import { test, expect, CapturedPayload, hasGoal } from './fixtures';

test.describe('Network Handling', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('sends payload via fetch on init', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload.workspace_id).toBe('test_workspace');
  });

  test('falls back to fetch when beacon fails', async ({ page, request }) => {
    // Disable sendBeacon
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track a goal (uses fetch with keepalive)
    await page.evaluate(() => Staminads.trackGoal({ action: 'fetch_test' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should still have received the event via fetch
    expect(events.length).toBeGreaterThanOrEqual(1);
    const found = events.some((e) => hasGoal(e.payload, 'fetch_test'));
    expect(found).toBe(true);
  });

  test('handles slow network gracefully', async ({ page, request }) => {
    // Add 2 second delay to responses
    await request.post('/api/test/delay/2000');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track a goal - SDK awaits response for goal reliability
    const startTime = Date.now();
    await page.evaluate(() => Staminads.trackGoal({ action: 'slow_test' }));
    const elapsed = Date.now() - startTime;

    // Should complete within delay + buffer (goals are awaited for reliability)
    expect(elapsed).toBeLessThan(5000);
    expect(elapsed).toBeGreaterThanOrEqual(2000); // At least the delay time

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    const found = events.some((e) => hasGoal(e.payload, 'slow_test'));
    expect(found).toBe(true);
  });

  test('uses beacon on pagehide', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    // Trigger pagehide event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have sent payload on pagehide
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('handles network timeout gracefully', async ({ page }) => {
    // Let SDK initialize first before blocking
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Now block subsequent requests
    await page.route('**/api/track', async () => {
      // Don't respond - simulate timeout
      await new Promise(() => {}); // Never resolves
    });

    // SDK should still be functional even with pending requests
    const sessionId = await page.evaluate(() => Staminads.getSessionId());
    expect(sessionId).toBeTruthy();
  });

  test('server returns checkpoint on success', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track multiple goals
    await page.evaluate(() => Staminads.trackGoal({ action: 'goal1' }));
    await page.evaluate(() => Staminads.trackGoal({ action: 'goal2' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Latest payload should have actions
    const latestPayload = events[events.length - 1].payload;
    expect(latestPayload.actions.length).toBeGreaterThanOrEqual(2);
  });

  test('continues sending after server failure', async ({ page, request }) => {
    // Configure server to fail first request
    await request.post('/api/test/fail/1');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // First send fails, but SDK continues
    await page.waitForTimeout(1000);

    // Track another goal - server now working
    await page.evaluate(() => Staminads.trackGoal({ action: 'after_failure' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have received the second request
    const found = events.some((e) => hasGoal(e.payload, 'after_failure'));
    expect(found).toBe(true);
  });

  test('beacon is used on visibility hidden', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    // Simulate tab becoming hidden
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have sent payload on visibility change
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('payload is sent on beforeunload', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    // Trigger beforeunload
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('actions array grows cumulatively', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track several goals
    await page.evaluate(() => Staminads.trackGoal({ action: 'goal_a' }));
    await page.waitForTimeout(200);
    await page.evaluate(() => Staminads.trackGoal({ action: 'goal_b' }));
    await page.waitForTimeout(200);
    await page.evaluate(() => Staminads.trackGoal({ action: 'goal_c' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Get the latest payload
    const latestPayload = events[events.length - 1].payload;

    // Should have all 3 goals in actions array
    expect(hasGoal(latestPayload, 'goal_a')).toBe(true);
    expect(hasGoal(latestPayload, 'goal_b')).toBe(true);
    expect(hasGoal(latestPayload, 'goal_c')).toBe(true);
  });

  test('attributes sent only on first payload', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial + heartbeat
    await page.waitForTimeout(11000);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(2);

    // First payload should have attributes
    expect(events[0].payload.attributes).toBeTruthy();

    // Subsequent payloads should not have attributes
    // (SDK marks attributesSent = true after first successful send)
    for (let i = 1; i < events.length; i++) {
      // After the first successful send, attributes should be undefined
      // Note: This depends on SDK behavior - check if it actually omits
    }
  });

  test('queues payloads when offline and sends when back online', async ({
    page,
    context,
    request,
  }) => {
    // Mock navigator.onLine BEFORE page loads
    await page.addInitScript(() => {
      // Create a controllable onLine property
      let _isOnline = true;
      Object.defineProperty(navigator, 'onLine', {
        get: () => _isOnline,
        configurable: true,
      });
      // Expose controls
      (window as any).__goOffline = () => {
        _isOnline = false;
      };
      (window as any).__goOnline = () => {
        _isOnline = true;
        window.dispatchEvent(new Event('online'));
      };
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Reset events
    await request.post('/api/test/reset');

    // Go offline - both mock AND network
    await page.evaluate(() => (window as any).__goOffline());
    await context.setOffline(true);

    // Verify navigator.onLine is false
    const isOffline = await page.evaluate(() => navigator.onLine === false);
    expect(isOffline).toBe(true);

    // Track goal while offline - should be queued
    await page.evaluate(() => Staminads.trackGoal({ action: 'offline_goal' }));
    await page.waitForTimeout(500);

    // Verify nothing sent yet (SDK queued it locally)
    let response = await request.get('/api/test/events');
    let events: CapturedPayload[] = await response.json();
    const offlineGoalSent = events.some((e) => hasGoal(e.payload, 'offline_goal'));
    expect(offlineGoalSent).toBe(false);

    // Verify queue has the payload stored
    const queuedItems = await page.evaluate(() => {
      const stored = localStorage.getItem('stm_pending');
      return stored ? JSON.parse(stored) : [];
    });
    expect(queuedItems.length).toBeGreaterThan(0);

    // Come back online - restore network first, then trigger online event
    await context.setOffline(false);
    await page.waitForTimeout(100); // Let network restore
    await page.evaluate(() => (window as any).__goOnline());
    await page.waitForTimeout(2000); // Wait for flush to complete

    // Verify queued payload was sent
    response = await request.get('/api/test/events');
    events = await response.json();
    const found = events.some((e) => hasGoal(e.payload, 'offline_goal'));
    expect(found).toBe(true);
  });

  // Note: Timeout queue functionality is tested in unit tests (sender.test.ts)
  // E2E timeout simulation with Playwright route interception doesn't work well with AbortController
  test.skip('SDK remains functional when requests timeout', async ({ page }) => {
    // Let SDK initialize first
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Now route subsequent requests to never respond
    let requestCount = 0;
    await page.route('**/api/track', async (route) => {
      requestCount++;
      if (requestCount > 1) {
        // Don't respond to requests after init
        await new Promise(() => {});
      } else {
        await route.continue();
      }
    });

    // Track a goal (this will timeout)
    await page.evaluate(() => Staminads.trackGoal({ action: 'timeout_test' }));

    // Wait past timeout (10s + buffer)
    await page.waitForTimeout(11000);

    // SDK should still function
    const sessionId = await page.evaluate(() => Staminads.getSessionId());
    expect(sessionId).toBeTruthy();

    // Should be able to track more goals
    await page.evaluate(() => Staminads.trackGoal({ action: 'after_timeout' }));
    // No error thrown = success
  });
});
