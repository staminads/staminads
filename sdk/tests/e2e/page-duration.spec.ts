/**
 * Page Duration E2E Tests
 *
 * Tests page duration tracking via the V3 actions[] array model.
 * Each page visit becomes a pageview action with duration when the user navigates away.
 *
 * Updated for V3 SessionPayload format.
 */

import { test, expect, CapturedPayload, getPageviews, PageviewAction } from './fixtures';

test.describe('Page Duration Tracking', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/test/reset');
  });

  test.describe('Navigation creates pageview actions', () => {
    test('landing page is tracked as current_page', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      expect(events.length).toBeGreaterThanOrEqual(1);

      // First payload should have current_page (the page user is on)
      const landing = events[0].payload;
      expect(landing.current_page).toBeTruthy();
      expect(landing.current_page?.path).toContain('/');

      // No completed pageview actions yet (still on first page)
      expect(landing.actions.length).toBe(0);
    });

    test('navigation creates completed pageview with duration', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Stay on landing for 2 seconds
      await page.waitForTimeout(2000);

      // Navigate to products
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Find payload with completed pageview
      let completedPageview: PageviewAction | undefined;
      for (const event of events) {
        const pageviews = getPageviews(event.payload);
        if (pageviews.length > 0) {
          completedPageview = pageviews[0];
          break;
        }
      }

      expect(completedPageview).toBeTruthy();
      // Duration should be around 2 seconds (in milliseconds)
      expect(completedPageview!.duration).toBeGreaterThanOrEqual(1500);
      expect(completedPageview!.duration).toBeLessThan(5000);
    });

    test('multiple navigations create multiple pageview actions', async ({ page, request }) => {
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

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Get the latest payload
      const latestPayload = events[events.length - 1].payload;

      // Should have 3 completed pageviews
      const pageviews = getPageviews(latestPayload);
      expect(pageviews.length).toBeGreaterThanOrEqual(3);

      // Each pageview should have duration
      for (const pv of pageviews) {
        expect(pv.duration).toBeGreaterThan(0);
        expect(pv.page_number).toBeGreaterThanOrEqual(1);
      }
    });

    test('back button navigation creates pageview action', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);
      await page.waitForTimeout(500);

      // Navigate forward
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(1500);

      // Go back
      await page.goBack();
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Get the latest payload
      const latestPayload = events[events.length - 1].payload;

      // Should have pageviews for both navigations
      const pageviews = getPageviews(latestPayload);
      expect(pageviews.length).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('Duration accuracy', () => {
    test('duration is in milliseconds', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Wait 3 seconds on landing
      await page.waitForTimeout(3000);

      // Navigate to trigger pageview completion
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Find completed pageview
      for (const event of events) {
        const pageviews = getPageviews(event.payload);
        if (pageviews.length > 0) {
          // Duration should be > 1000 (1 second in milliseconds)
          expect(pageviews[0].duration).toBeGreaterThan(1000);
          break;
        }
      }
    });

    test('unload sends current page data', async ({ page, request, context }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      // Spend time on page
      await page.waitForTimeout(2000);

      // Trigger page unload by closing
      await page.close();

      // Give time for beacon to be sent
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Should have at least one payload
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Edge cases', () => {
    test('rapid navigations create pageview for each page', async ({ page, request }) => {
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

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Get the latest payload
      const latestPayload = events[events.length - 1].payload;

      // Should have pageviews for each navigation
      const pageviews = getPageviews(latestPayload);
      expect(pageviews.length).toBeGreaterThanOrEqual(3);

      // Each navigation event should have duration (even if small)
      for (const pv of pageviews) {
        expect(pv.duration).toBeDefined();
        expect(pv.duration).toBeGreaterThanOrEqual(0);
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

      // Time while hidden (should not count toward focus duration)
      await page.waitForTimeout(2000);

      // Navigate (should trigger pageview with duration)
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Find completed pageview
      for (const event of events) {
        const pageviews = getPageviews(event.payload);
        if (pageviews.length > 0) {
          // Duration should be ~1.5s (active time only), not 3.5s
          expect(pageviews[0].duration).toBeGreaterThanOrEqual(1000);
          expect(pageviews[0].duration).toBeLessThan(3000);
          break;
        }
      }
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

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Should still have captured payloads
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Page numbering', () => {
    test('pages are numbered sequentially', async ({ page, request }) => {
      await page.goto('/spa-page.html');
      await page.waitForFunction(() => window.SDK_INITIALIZED);

      await page.waitForTimeout(500);
      await page.click('nav a:has-text("Products")');
      await page.waitForTimeout(500);
      await page.click('nav a:has-text("About")');
      await page.waitForTimeout(500);

      const response = await request.get('/api/test/events');
      const events: CapturedPayload[] = await response.json();

      // Get the latest payload
      const latestPayload = events[events.length - 1].payload;

      // Check page numbers are sequential
      const pageviews = getPageviews(latestPayload);
      for (let i = 0; i < pageviews.length; i++) {
        expect(pageviews[i].page_number).toBe(i + 1);
      }
    });
  });
});
