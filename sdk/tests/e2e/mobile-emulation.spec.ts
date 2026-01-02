/**
 * Mobile Behavior E2E Tests - Mobile Emulation
 *
 * Tests mobile-specific behavior using Pixel 5 emulation (Chromium compatible).
 */

import { test, expect, devices } from './fixtures';

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

    const response = await request.get('/api/test/events/screen_view');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);

    const payload = events[0].payload;
    expect(payload.device).toBe('mobile');
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

    await page.evaluate(() => Staminads.track('scroll_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/scroll_check');
    const events = await response.json();

    expect(events.length).toBe(1);
    expect(events[0].payload.max_scroll).toBeGreaterThan(0);
  });

  test('uses shorter heartbeat interval on mobile (7s)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for mobile heartbeat (7s) + buffer
    await page.waitForTimeout(8000);

    const response = await request.get('/api/test/events/ping');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('handles freeze event (background app)', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      document.dispatchEvent(new Event('freeze'));
    });

    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      document.dispatchEvent(new Event('resume'));
    });

    await page.waitForTimeout(500);

    await page.evaluate(() => Staminads.track('freeze_check'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/freeze_check');
    const events = await response.json();

    const duration = events[0].payload.duration * 1000;
    expect(duration).toBeLessThan(2000);
  });

  test('reports correct viewport size', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/screen_view');
    const events = await response.json();

    const payload = events[0].payload;

    // Pixel 5 viewport is 393x851 in portrait
    expect(payload.viewport_width).toBeLessThan(500);
    expect(payload.viewport_height).toBeGreaterThan(payload.viewport_width);
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

    const response = await request.get('/api/test/events/button_click');
    const events = await response.json();

    expect(events.length).toBe(1);
  });

  test('touch scroll updates max_scroll', async ({ page, request }) => {
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

    await page.evaluate(() => Staminads.track('scroll_final'));
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/scroll_final');
    const events = await response.json();

    expect(events[0].payload.max_scroll).toBeGreaterThan(25);
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
