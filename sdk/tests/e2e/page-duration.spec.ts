/**
 * Page Duration E2E Tests
 *
 * Tests page_duration tracking, previous_path associations, and ping events
 * with accurate page metrics in real browser scenarios.
 *
 * Note: The SDK sends page_duration as a string property. The API backend
 * converts it to a number. These E2E tests use a mock server that passes
 * through raw payloads, so we parse the values here.
 */

import { test, expect } from './fixtures';

// Helper to get page_duration from payload (handles string or number)
function getPageDuration(payload: Record<string, unknown>): number | undefined {
  const val = payload.page_duration;
  if (val === undefined) return undefined;
  return typeof val === 'string' ? parseInt(val, 10) : (val as number);
}

test.describe('Page Duration Tracking', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test.describe('Navigation screen_view events', () => {
    test('landing page screen_view has no page_duration', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      expect(events.length).toBeGreaterThanOrEqual(1);

      // First screen_view should NOT have page_duration (it's the landing)
      const landing = events[0].payload as Record<string, unknown>;
      expect(landing.page_duration).toBeUndefined();
      expect(landing.previous_path).toBeUndefined();
    });

    test('navigation sends screen_view with page_duration', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Stay on landing for 2 seconds
      await page.waitForTimeout(2000);

      // Navigate to products
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      // Should have 2 screen_views: landing + navigation
      expect(events.length).toBe(2);

      // Second event should have page_duration
      const navEvent = events[1].payload as Record<string, unknown>;
      const pageDuration = getPageDuration(navEvent);
      expect(pageDuration).toBeDefined();
      // Duration should be around 2 seconds (allow 1s tolerance)
      expect(pageDuration).toBeGreaterThanOrEqual(1);
      expect(pageDuration).toBeLessThan(5);
    });

    test('navigation sends screen_view with previous_path', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(500);

      // Navigate to about
      await page.click('nav a:has-text("About")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      expect(events.length).toBe(2);

      // Navigation event should have previous_path set to landing path
      const navEvent = events[1].payload as Record<string, unknown>;
      expect(navEvent.previous_path).toBe('/home');
      expect(navEvent.path).toBe('/about');
    });

    test('multiple navigations track correct durations and paths', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Landing page: /home
      await page.waitForTimeout(1500);

      // Navigate to products (should record ~1.5s on /home)
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(2000);

      // Navigate to about (should record ~2s on /products)
      await page.click('nav a:has-text("About")');
      await page.waitForTimeout(1000);

      // Navigate to contact (should record ~1s on /about)
      await page.click('nav a:has-text("Contact")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      expect(events.length).toBe(4);

      // Event 1: Landing (no duration)
      const e1 = events[0].payload as Record<string, unknown>;
      expect(e1.path).toBe('/home');
      expect(getPageDuration(e1)).toBeUndefined();

      // Event 2: /home -> /products (~1.5s on /home)
      const e2 = events[1].payload as Record<string, unknown>;
      expect(e2.path).toBe('/products');
      expect(e2.previous_path).toBe('/home');
      expect(getPageDuration(e2)).toBeGreaterThanOrEqual(1);
      expect(getPageDuration(e2)).toBeLessThan(4);

      // Event 3: /products -> /about (~2s on /products)
      const e3 = events[2].payload as Record<string, unknown>;
      expect(e3.path).toBe('/about');
      expect(e3.previous_path).toBe('/products');
      expect(getPageDuration(e3)).toBeGreaterThanOrEqual(1);
      expect(getPageDuration(e3)).toBeLessThan(5);

      // Event 4: /about -> /contact (~1s on /about)
      const e4 = events[3].payload as Record<string, unknown>;
      expect(e4.path).toBe('/contact');
      expect(e4.previous_path).toBe('/about');
      expect(getPageDuration(e4)).toBeGreaterThanOrEqual(0);
      expect(getPageDuration(e4)).toBeLessThan(4);
    });

    test('back button navigation tracks duration correctly', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(500);

      // Navigate forward
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(1500);

      // Go back
      await page.goBack();
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      expect(events.length).toBe(3);

      // Event 3: back navigation from /products to /home
      const backEvent = events[2].payload as Record<string, unknown>;
      expect(backEvent.path).toBe('/home');
      expect(backEvent.previous_path).toBe('/products');
      expect(getPageDuration(backEvent)).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Ping events', () => {
    test('unload ping includes page_duration', async ({ page, request, context }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Spend time on page
      await page.waitForTimeout(2000);

      // Trigger page unload by closing
      await page.close();

      // Give time for beacon to be sent
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await request.get('/api/test/events/ping');
      const events = await response.json();

      // Should have at least one ping with page_duration
      const unloadPing = events.find(
        (e: { payload: Record<string, unknown> }) => getPageDuration(e.payload) !== undefined
      );

      expect(unloadPing).toBeDefined();
      const duration = getPageDuration(unloadPing.payload);
      expect(duration).toBeGreaterThanOrEqual(1);
      expect(duration).toBeLessThan(10);
    });

  });

  test.describe('Edge cases', () => {
    test('rapid navigations track each page duration', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(200);

      // Rapid navigations
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(200);
      await page.click('nav a:has-text("About")');
      await page.waitForTimeout(200);
      await page.click('nav a:has-text("Contact")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      // Should have 4 screen_views
      expect(events.length).toBe(4);

      // Each navigation event should have page_duration (even if small)
      for (let i = 1; i < events.length; i++) {
        const e = events[i].payload as Record<string, unknown>;
        const duration = getPageDuration(e);
        expect(duration).toBeDefined();
        // Small durations are valid
        expect(duration).toBeGreaterThanOrEqual(0);
      }
    });

    test('duration pauses when tab is hidden', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Active time
      await page.waitForTimeout(1500);

      // Hide tab
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Time while hidden (should not count)
      await page.waitForTimeout(2000);

      // Navigate (should trigger screen_view with duration)
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      expect(events.length).toBe(2);

      // Duration should be ~1.5s (active time only), not 3.5s
      const navEvent = events[1].payload as Record<string, unknown>;
      expect(getPageDuration(navEvent)).toBeGreaterThanOrEqual(1);
      expect(getPageDuration(navEvent)).toBeLessThan(3);
    });

    test('handles visibility change during navigation', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(1000);

      // Hide just before navigation
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Navigate while hidden
      await page.evaluate(() => {
        history.pushState({ path: '/products' }, '', '/products');
      });

      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events/screen_view');
      const events = await response.json();

      // Should still have captured the navigation
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// TypeScript declarations
declare global {
  interface Window {
    SDK_INITIALIZED: boolean;
    SDK_READY: Promise<void>;
    Staminads: {
      trackEvent: (name: string, data?: Record<string, unknown>) => void;
      track: (name: string, data?: Record<string, unknown>) => void;
    };
  }
  const Staminads: Window['Staminads'];
}
