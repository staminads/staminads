/**
 * Mobile Behavior E2E Tests - Desktop
 *
 * Tests desktop behavior to compare with mobile.
 * Updated for V3 SessionPayload format.
 */

import { test, expect, CapturedPayload } from './fixtures';

test.describe('Desktop Behavior', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('desktop reports device as desktop', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);

    // V3: Device info is in attributes (first payload only)
    const firstPayload = events[0].payload;
    expect(firstPayload.attributes).toBeTruthy();
    expect(firstPayload.attributes?.device).toBe('desktop');
  });

  test('desktop uses longer heartbeat interval (10s)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // At 7s, desktop should only have 1 payload (initial)
    await page.waitForTimeout(7500);

    const response1 = await request.get('/api/test/events');
    const events1: CapturedPayload[] = await response1.json();

    const countAt7s = events1.length;

    // At 11s, desktop should have additional payload from heartbeat
    await page.waitForTimeout(4000);

    const response2 = await request.get('/api/test/events');
    const events2: CapturedPayload[] = await response2.json();

    expect(events2.length).toBeGreaterThan(countAt7s);
  });

  test('sends workspace_id in all payloads', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(11000);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    for (const event of events) {
      expect(event.payload.workspace_id).toBe('test_workspace');
    }
  });
});
