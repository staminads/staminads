/**
 * Session Lifecycle E2E Tests
 *
 * Tests the full session lifecycle: init, track, navigate, close, reopen, resume.
 */

import { test, expect } from './fixtures';

test.describe('Session Lifecycle', () => {
  test.beforeEach(async ({ request }) => {
    // Reset mock server state
    await request.post('/api/test/reset');
  });

  test('creates new session on first visit', async ({ page }) => {
    await page.goto('/test-page.html');

    // Wait for SDK to initialize
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Check session ID exists
    const sessionId = await page.evaluate(() => Staminads.getSessionId());
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(10);
  });

  test('creates visitor ID on first visit', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const visitorId = await page.evaluate(() => Staminads.getVisitorId());
    expect(visitorId).toBeTruthy();
    expect(typeof visitorId).toBe('string');
  });

  test('tracks screen_view on init', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial screen_view event
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/screen_view');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload.name).toBe('screen_view');
    expect(events[0].payload.workspace_id).toBe('test_workspace');
  });

  test('session survives page reload', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId1 = await page.evaluate(() => Staminads.getSessionId());
    const visitorId1 = await page.evaluate(() => Staminads.getVisitorId());

    // Reload page
    await page.reload();
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId2 = await page.evaluate(() => Staminads.getSessionId());
    const visitorId2 = await page.evaluate(() => Staminads.getVisitorId());

    // Session and visitor should persist
    expect(sessionId2).toBe(sessionId1);
    expect(visitorId2).toBe(visitorId1);
  });

  test('tracks ping events on heartbeat', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for heartbeat (10s on desktop, but we'll wait shorter and check)
    // Note: In real test we'd mock time, but here we wait for actual heartbeat
    await page.waitForTimeout(11000);

    const response = await request.get('/api/test/events/ping');
    const events = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload.name).toBe('ping');
  });

  test('tracks custom events via track()', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track custom event
    await page.click('#btn-track');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/button_click');
    const events = await response.json();

    expect(events.length).toBe(1);
    // trackEvent sends name='ping' with event_name for custom event name
    expect(events[0].payload.name).toBe('ping');
    expect(events[0].payload.event_name).toBe('button_click');
  });

  test('tracks conversions via conversion()', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track conversion
    await page.click('#btn-conversion');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/conversion');
    const events = await response.json();

    expect(events.length).toBe(1);
    expect(events[0].payload.name).toBe('conversion');
    expect(events[0].payload.conversion_name).toBe('signup');
    // Value is sent as string in the payload
    expect(events[0].payload.conversion_value).toBe('99.99');
  });

  test('sets custom dimensions', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Set dimension
    await page.evaluate(() => Staminads.setDimension(1, 'test_value'));

    // Read dimension
    const dimension = await page.evaluate(() => Staminads.getDimension(1));
    expect(dimension).toBe('test_value');
  });

  test('SPA navigation triggers new screen_view', async ({ page, request }) => {
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Initial screen_view
    await page.waitForTimeout(500);

    // Navigate to products
    await page.click('text=Products');
    await page.waitForTimeout(500);

    // Navigate to about
    await page.click('text=About');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events/screen_view');
    const events = await response.json();

    // Should have multiple screen_view events for each navigation
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test('session resumes within timeout window', async ({ page, context }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId1 = await page.evaluate(() => Staminads.getSessionId());

    // Close and reopen page (simulates tab close/reopen)
    await page.close();

    const newPage = await context.newPage();
    await newPage.goto('/test-page.html');
    await newPage.waitForFunction(() => window.SDK_INITIALIZED);
    await newPage.evaluate(() => window.SDK_READY);

    const sessionId2 = await newPage.evaluate(() => Staminads.getSessionId());

    // Session should be resumed (same ID)
    expect(sessionId2).toBe(sessionId1);
  });
});

// TypeScript declarations for window
declare global {
  interface Window {
    SDK_READY: Promise<void>;
    Staminads: {
      getSessionId: () => string;
      getVisitorId: () => string;
      track: (name: string, data?: Record<string, unknown>) => void;
      conversion: (name: string, value?: number, currency?: string) => void;
      setDimension: (index: number, value: string) => void;
      getDimension: (index: number) => string | null;
    };
  }
  const Staminads: Window['Staminads'];
}
