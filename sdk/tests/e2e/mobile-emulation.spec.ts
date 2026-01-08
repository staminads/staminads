/**
 * Mobile Behavior E2E Tests - Mobile Emulation
 *
 * Tests mobile-specific behavior using Pixel 5 emulation (Chromium compatible).
 * Updated for V3 SessionPayload format.
 */

import { test, expect, devices, CapturedPayload, hasGoal } from './fixtures';

// Mobile device configuration - must be at top level
// Using Pixel 5 (Android) instead of iPhone to work with Chromium
const pixel5 = devices['Pixel 5'];
test.use({ ...pixel5 });

test.describe('Mobile Emulation', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test('detects mobile device correctly', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);

    // V3: Device info is in attributes
    const payload = events[0].payload;
    expect(payload.attributes?.device).toBe('mobile');
  });

  test('handles touch scroll events', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.touchscreen.tap(200, 300);

    await page.evaluate(() => {
      window.scrollTo(0, 500);
      window.dispatchEvent(new Event('scroll'));
    });

    await page.waitForTimeout(500);

    await page.evaluate(() => Staminads.trackGoal({ action: 'scroll_check' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Find payload with the goal
    const payloadWithGoal = events.find((e) => hasGoal(e.payload, 'scroll_check'));
    expect(payloadWithGoal).toBeTruthy();

    // Check current_page scroll
    expect(payloadWithGoal?.payload.current_page?.scroll).toBeGreaterThan(0);
  });

  test('uses shorter heartbeat interval on mobile (7s)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for mobile heartbeat (7s) + buffer
    await page.waitForTimeout(8000);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have received at least 2 payloads (initial + 1 heartbeat)
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test('handles freeze event (background app)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait some time focused
    await page.waitForTimeout(1000);

    // Freeze the app (should pause duration tracking)
    await page.evaluate(() => {
      document.dispatchEvent(new Event('freeze'));
    });

    // Time passes while frozen (should NOT count toward duration)
    await page.waitForTimeout(2000);

    // Resume the app
    await page.evaluate(() => {
      document.dispatchEvent(new Event('resume'));
    });

    // Wait a bit more focused
    await page.waitForTimeout(500);

    await page.evaluate(() => Staminads.trackGoal({ action: 'freeze_check' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // SDK should have handled freeze/resume events
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('reports correct viewport size', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    const payload = events[0].payload;

    // Pixel 5 viewport is 393x851 in portrait
    expect(payload.attributes?.viewport_width).toBeLessThan(500);
    expect(payload.attributes?.viewport_height).toBeGreaterThan(payload.attributes?.viewport_width || 0);
  });

  test('handles orientation change', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const initialViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    await page.setViewportSize({ width: 844, height: 390 });

    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });

    await page.waitForTimeout(500);

    const newViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    expect(newViewport.width).toBeGreaterThan(initialViewport.width);
  });

  test('tracks touch-based clicks', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.tap('#btn-track');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have payload with button_click goal
    const payloadWithGoal = events.find((e) => hasGoal(e.payload, 'button_click'));
    expect(payloadWithGoal).toBeTruthy();
  });

  test('touch scroll updates scroll in current_page', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.evaluate(() => {
      window.scrollTo(0, 500);
      window.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.scrollTo(0, 1000);
      window.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => Staminads.trackGoal({ action: 'scroll_final' }));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Find payload with the goal
    const payloadWithGoal = events.find((e) => hasGoal(e.payload, 'scroll_final'));
    expect(payloadWithGoal).toBeTruthy();

    // Check scroll is tracked
    expect(payloadWithGoal?.payload.current_page?.scroll).toBeGreaterThan(25);
  });
});
