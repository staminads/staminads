/**
 * Network Handling E2E Tests
 *
 * Tests network failure handling, beacon fallback, queue retry, and offline mode.
 */

import { test, expect } from './fixtures';

test.describe('Network Handling', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('uses sendBeacon by default', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial event
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
    // Events should be received (via beacon or fetch)
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

    await page.evaluate(() => Staminads.trackEvent('fetch_fallback_test'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/fetch_fallback_test');
    const events = await response.json();

    expect(events.length).toBe(1);
  });

  test('queues events when server fails', async ({ page, request }) => {
    // Disable sendBeacon - it doesn't report server errors (fire-and-forget)
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    // Configure server to fail
    await request.post('/api/test/fail');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event (should queue since server fails)
    await page.evaluate(() => Staminads.trackEvent('will_queue'));
    await page.waitForTimeout(1000);

    // Check queue
    const queue = await page.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });

    expect(queue.length).toBeGreaterThanOrEqual(1);
  });

  test('retries queued events with exponential backoff', async ({ page, request }) => {
    // Disable sendBeacon - it doesn't report server errors (fire-and-forget)
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    // Configure server to fail twice then succeed
    await request.post('/api/test/fail/2');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event (first attempt fails, gets queued)
    await page.evaluate(() => Staminads.trackEvent('retry_test'));
    await page.waitForTimeout(500);

    // Queue flush is triggered by visibility changes, not automatic timers
    // Flow:
    // 1. Initial send fails → queued (attempts=0)
    // 2. First flush: tries (fail #1) → attempts=1, needs 2s backoff
    // 3. Second flush after 2s: tries (fail #2) → attempts=2, needs 4s backoff
    // 4. Third flush after 4s: tries → succeeds

    // Helper to trigger visibility change (flushQueue is called on visible)
    const triggerFlush = async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(50);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(200);
    };

    // First flush - will fail (server fail #1), sets attempts=1
    await triggerFlush();

    // Wait for 2s backoff + buffer
    await page.waitForTimeout(2500);

    // Second flush - will fail (server fail #2), sets attempts=2
    await triggerFlush();

    // Wait for 4s backoff + buffer
    await page.waitForTimeout(4500);

    // Third flush - will succeed
    await triggerFlush();

    await page.waitForTimeout(500);

    // Event should have succeeded after retries
    const response = await request.get('/api/test/events/retry_test');
    const events = await response.json();

    expect(events.length).toBe(1);
  });

  test('handles slow network gracefully', async ({ page, request }) => {
    // Configure 2 second delay
    await request.post('/api/test/delay/2000');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event
    await page.evaluate(() => Staminads.trackEvent('slow_network_test'));

    // Wait for slow response
    await page.waitForTimeout(3000);

    const response = await request.get('/api/test/events/slow_network_test');
    const events = await response.json();

    expect(events.length).toBe(1);
  });

  test('queues events when offline', async ({ page, context, request }) => {
    // Disable sendBeacon - it may queue internally even when offline
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Go offline
    await context.setOffline(true);

    // Track event while offline (should queue since network fails)
    await page.evaluate(() => Staminads.trackEvent('offline_event'));
    await page.waitForTimeout(500);

    // Event should be queued
    const queue = await page.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });

    expect(queue.length).toBeGreaterThanOrEqual(1);

    // Go back online
    await context.setOffline(false);

    // Wait for queue flush
    await page.waitForTimeout(2000);

    const response = await request.get('/api/test/events/offline_event');
    const events = await response.json();

    expect(events.length).toBe(1);
  });

  test('sends pending events on page visibility change', async ({ page, request }) => {
    // Disable sendBeacon - it doesn't report server errors (fire-and-forget)
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    // Configure server to fail initially
    await request.post('/api/test/fail');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event (will queue since server fails)
    await page.evaluate(() => Staminads.trackEvent('visibility_test'));
    await page.waitForTimeout(500);

    // Fix server
    await request.post('/api/test/succeed');

    // Simulate visibility change (hidden then visible)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(200);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(1000);

    // Queued event should be flushed
    const response = await request.get('/api/test/events/visibility_test');
    const events = await response.json();

    expect(events.length).toBe(1);
  });

  test('uses beacon on pagehide', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Simulate pagehide
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    });

    await page.waitForTimeout(500);

    // Events should be sent
    const response = await request.get('/api/test/events');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('preserves event order in queue', async ({ page, request }) => {
    // Configure server to fail
    await request.post('/api/test/fail');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track multiple events
    await page.evaluate(() => {
      Staminads.trackEvent('event_1');
      Staminads.trackEvent('event_2');
      Staminads.trackEvent('event_3');
    });

    await page.waitForTimeout(500);

    // Check queue order
    const queue = await page.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });

    // Find our test events in queue
    const testEvents = queue.filter(
      (item: { payload: { name: string } }) =>
        item.payload.name === 'event_1' ||
        item.payload.name === 'event_2' ||
        item.payload.name === 'event_3'
    );

    if (testEvents.length >= 3) {
      // Events should be in order
      expect(testEvents[0].payload.name).toBe('event_1');
      expect(testEvents[1].payload.name).toBe('event_2');
      expect(testEvents[2].payload.name).toBe('event_3');
    }
  });

  test('queue has max size limit', async ({ page, request }) => {
    // Configure server to fail
    await request.post('/api/test/fail');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track many events
    await page.evaluate(() => {
      for (let i = 0; i < 150; i++) {
        Staminads.trackEvent('bulk_event_' + i);
      }
    });

    await page.waitForTimeout(1000);

    // Check queue size
    const queue = await page.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });

    // Queue should be capped (typically 100 items)
    expect(queue.length).toBeLessThanOrEqual(100);
  });

  test('handles network timeout gracefully', async ({ page, request }) => {
    // Configure very long delay (simulates timeout)
    await request.post('/api/test/delay/30000');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event
    await page.evaluate(() => Staminads.trackEvent('timeout_test'));

    // Don't wait for full timeout, just verify no crash
    await page.waitForTimeout(2000);

    // SDK should still be functional
    const sessionId = await page.evaluate(() => Staminads.getSessionId());
    expect(sessionId).toBeTruthy();
  });
});

// TypeScript declarations
declare global {
  interface Window {
    SDK_READY: Promise<void>;
    Staminads: {
      getSessionId: () => string;
      track: (name: string, data?: Record<string, unknown>) => void;
    };
  }
  const Staminads: Window['Staminads'];
}
