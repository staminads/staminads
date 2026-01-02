/**
 * Mobile Behavior E2E Tests - Desktop
 *
 * Tests desktop behavior to compare with mobile.
 */

import { test, expect } from './fixtures';

test.describe('Desktop Behavior', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('desktop reports device as desktop', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/screen_view');
    const events = await response.json();

    expect(events[0].payload.device).toBe('desktop');
  });

  test('desktop uses longer heartbeat interval (10s)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // At 7s, desktop should not have ping yet
    await page.waitForTimeout(7500);

    const response1 = await request.get('/api/test/events/ping');
    const events1 = await response1.json();

    const countAt7s = events1.length;

    // At 11s, desktop should have ping
    await page.waitForTimeout(4000);

    const response2 = await request.get('/api/test/events/ping');
    const events2 = await response2.json();

    expect(events2.length).toBeGreaterThan(countAt7s);
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
