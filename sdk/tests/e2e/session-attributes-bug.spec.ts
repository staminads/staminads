/**
 * Session Attributes Bug E2E Test
 *
 * This test reproduces the bug where device/browser/OS information is not
 * stored in the events table because:
 *
 * 1. SDK sends first payload with `actions: []` (user still on first page)
 *    and `attributes: { device: 'desktop', browser: 'Chrome', ... }`
 * 2. API sees `actions.length === 0` and returns early WITHOUT creating events
 * 3. Attributes are DISCARDED
 * 4. Later payloads have completed actions but NO attributes
 * 5. Events are created with empty device/browser/OS fields
 *
 * This is a full E2E test using Playwright + real API + ClickHouse.
 */

import { test, expect, truncateEvents, waitForEvents, queryEvents } from './fixtures';

test.describe('Session Attributes Bug', () => {
  test.beforeEach(async () => {
    // Clear events table before each test
    await truncateEvents();
  });

  test('BUG: first payload with empty actions loses device attributes', async ({ page }) => {
    // Navigate to test page - SDK initializes and sends first payload
    // At this point: actions=[], attributes={device:'desktop',...}
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Get session ID for querying
    const sessionId = await page.evaluate(() => Staminads.getSessionId());

    // Navigate away to trigger pageview completion
    // This creates a completed action that gets sent in next payload
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait a bit for the SDK to send the pageview
    await page.waitForTimeout(2000);

    // Wait for events to appear in ClickHouse
    const events = await waitForEvents(sessionId, 1, 15000);

    // We should have at least one event (the completed pageview from test-page.html)
    expect(events.length).toBeGreaterThanOrEqual(1);

    // BUG: The event should have device info, but it's empty because:
    // - First payload (with attributes) had actions: [] so no event was created
    // - Second payload (with the completed pageview) had no attributes
    const firstEvent = events[0];

    // These assertions document the BUG - device info is EMPTY
    expect(firstEvent.device).toBe(''); // BUG: should be 'desktop'
    expect(firstEvent.browser).toBe(''); // BUG: should be 'Chrome' or similar
    expect(firstEvent.os).toBe(''); // BUG: should be the OS
    expect(firstEvent.user_agent).toBe(''); // BUG: should have user agent
    expect(firstEvent.language).toBe(''); // BUG: should have language
    expect(firstEvent.timezone).toBe(''); // BUG: should have timezone

    // Landing page should still be captured (it's in the first payload that creates the event)
    // Actually, this might also be empty depending on the implementation
    console.log('Event data:', {
      session_id: firstEvent.session_id,
      path: firstEvent.path,
      device: firstEvent.device,
      browser: firstEvent.browser,
      os: firstEvent.os,
      landing_page: firstEvent.landing_page,
    });
  });

  test('BUG: all events from session have empty device info', async ({ page }) => {
    // Navigate to test page
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId = await page.evaluate(() => Staminads.getSessionId());

    // Track a goal (should create a goal event)
    await page.click('#btn-goal');
    await page.waitForTimeout(500);

    // Navigate to SPA page (completes first pageview, starts second)
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.waitForTimeout(1000);

    // Navigate within SPA (creates more pageviews)
    await page.click('nav a:has-text("Products")');
    await page.waitForTimeout(1000);

    await page.click('nav a:has-text("About")');
    await page.waitForTimeout(2000);

    // Wait for events
    const events = await waitForEvents(sessionId, 2, 15000);

    console.log(`Found ${events.length} events for session ${sessionId}`);

    // BUG: ALL events should have empty device info
    for (const event of events) {
      console.log(`Event: name=${event.name}, path=${event.path}, device=${event.device}, browser=${event.browser}`);

      // Document the bug: device fields are empty
      expect(event.device).toBe('');
      expect(event.browser).toBe('');
      expect(event.os).toBe('');
    }
  });

  test('verify SDK sends attributes in first payload (for debugging)', async ({ page }) => {
    // This test helps verify that the SDK IS sending attributes
    // by checking the browser's network requests

    // Set up request interception to capture the payload
    const payloads: unknown[] = [];
    await page.route('**/api/track', async (route) => {
      const request = route.request();
      const postData = request.postData();
      if (postData) {
        try {
          payloads.push(JSON.parse(postData));
        } catch {
          // ignore
        }
      }
      // Continue the request to the real API
      await route.continue();
    });

    // Navigate to test page
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for first payload to be sent
    await page.waitForTimeout(2000);

    // Check that first payload has attributes
    expect(payloads.length).toBeGreaterThan(0);

    const firstPayload = payloads[0] as {
      attributes?: {
        device?: string;
        browser?: string;
        os?: string;
      };
      actions?: unknown[];
    };

    console.log('First payload:', JSON.stringify(firstPayload, null, 2));

    // SDK DOES send attributes in first payload
    expect(firstPayload.attributes).toBeDefined();
    expect(firstPayload.attributes?.device).toBeDefined();
    expect(firstPayload.attributes?.browser).toBeDefined();

    // But actions is empty (user still on first page)
    expect(firstPayload.actions).toEqual([]);

    // This proves the bug: attributes ARE sent, but actions is empty,
    // so the API returns early and discards the attributes
  });
});
