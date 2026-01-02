/**
 * Clock Skew E2E Tests
 *
 * Tests that `sent_at` timestamp is properly included in all payloads
 * and can be used by the server for clock skew detection.
 *
 * Clock skew = received_at - sent_at
 *   - Positive skew: client clock is behind server (or network latency)
 *   - Negative skew: client clock is ahead of server (always wrong)
 */

import { test, expect, APIRequestContext } from './fixtures';

interface CapturedEvent {
  payload: {
    name: string;
    event_name?: string;
    sent_at?: number;
    session_id?: string;
    [key: string]: unknown;
  };
  _received_at: number;
}

// Helper to wait for events with retry
async function waitForEvents(
  request: APIRequestContext,
  minCount: number = 1,
  maxWaitMs: number = 5000
): Promise<CapturedEvent[]> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const response = await request.get('/api/test/events');
    const events: CapturedEvent[] = await response.json();
    if (events.length >= minCount) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  // Return whatever we have
  const response = await request.get('/api/test/events');
  return response.json();
}

test.describe('Clock Skew Detection', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
    // Small delay to ensure reset is complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test('all events include sent_at timestamp', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const events = await waitForEvents(request, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // All events should have sent_at timestamp
    for (const event of events) {
      expect(event.payload.sent_at).toBeDefined();
      expect(typeof event.payload.sent_at).toBe('number');
      expect(event.payload.sent_at).toBeGreaterThan(0);
    }
  });

  test('normal conditions: skew is minimal (< 5s)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const events = await waitForEvents(request, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Check skew for each event
    for (const event of events) {
      const skewMs = event._received_at - event.payload.sent_at!;
      // Normal latency should be well under 5 seconds
      expect(Math.abs(skewMs)).toBeLessThan(5000);
    }
  });

  test('detects client clock 1 hour ahead (negative skew)', async ({ page, request }) => {
    // Simulate client clock 1 hour ahead
    await page.addInitScript(() => {
      const realDateNow = Date.now;
      const offset = 60 * 60 * 1000; // 1 hour ahead
      Date.now = () => realDateNow() + offset;
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const events = await waitForEvents(request, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Check first event
    const event = events[0];
    const skewMs = event._received_at - event.payload.sent_at!;
    const skewMinutes = skewMs / 1000 / 60;

    // Skew should be approximately -60 minutes (client ahead)
    expect(skewMinutes).toBeLessThan(-55);
    expect(skewMinutes).toBeGreaterThan(-65);

    console.log(`Client 1h ahead: skew = ${skewMinutes.toFixed(1)} minutes`);
  });

  test('detects client clock 30 minutes behind (positive skew)', async ({ page, request }) => {
    // Simulate client clock 30 minutes behind
    await page.addInitScript(() => {
      const realDateNow = Date.now;
      const offset = -30 * 60 * 1000; // 30 minutes behind
      Date.now = () => realDateNow() + offset;
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const events = await waitForEvents(request, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Check first event
    const event = events[0];
    const skewMs = event._received_at - event.payload.sent_at!;
    const skewMinutes = skewMs / 1000 / 60;

    // Skew should be approximately +30 minutes (client behind)
    expect(skewMinutes).toBeGreaterThan(25);
    expect(skewMinutes).toBeLessThan(35);

    console.log(`Client 30m behind: skew = ${skewMinutes.toFixed(1)} minutes`);
  });

  test('skew calculation demonstrates correction threshold', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const events = await waitForEvents(request, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verify server can calculate skew and apply threshold logic
    const event = events[0];
    const skewMs = event._received_at - event.payload.sent_at!;

    // In normal conditions, skew should be minimal (<5s)
    // Server-side logic would check: |skew| > 5000ms to determine if correction needed
    const needsCorrection = Math.abs(skewMs) > 5000;

    // Under normal conditions, this should be false
    expect(needsCorrection).toBe(false);

    console.log(`Normal skew: ${skewMs}ms, needsCorrection = ${needsCorrection}`);
  });
});

// TypeScript declarations
declare global {
  interface Window {
    SDK_READY: Promise<void>;
    SDK_INITIALIZED: boolean;
    Staminads: {
      getSessionId: () => string;
      trackEvent: (name: string, properties?: Record<string, unknown>) => void;
    };
  }
  const Staminads: Window['Staminads'];
}
