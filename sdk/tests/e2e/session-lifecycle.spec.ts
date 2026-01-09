/**
 * Session Lifecycle E2E Tests
 *
 * Tests the full session lifecycle: init, track, navigate, close, reopen, resume.
 * Updated for V3 SessionPayload format with actions[] array.
 */

import { test, expect, CapturedPayload, getGoals, hasGoal } from './fixtures';

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

  test('sends initial payload with current_page on init', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial payload
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);

    // V3: Check payload structure
    const payload = events[0].payload;
    expect(payload.workspace_id).toBe('test_workspace');
    expect(payload.session_id).toBeTruthy();
    expect(payload.sdk_version).toBeTruthy();
    expect(payload.created_at).toBeGreaterThan(0);
    expect(payload.updated_at).toBeGreaterThan(0);

    // Should have current_page (the page user is currently on)
    expect(payload.current_page).toBeTruthy();
    expect(payload.current_page?.path).toBe('/test-page.html');

    // First payload should include attributes
    expect(payload.attributes).toBeTruthy();
    expect(payload.attributes?.landing_page).toContain('test-page.html');
  });

  test('session survives page reload', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId1 = await page.evaluate(() => Staminads.getSessionId());

    // Reload page
    await page.reload();
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId2 = await page.evaluate(() => Staminads.getSessionId());

    // Session should persist
    expect(sessionId2).toBe(sessionId1);
  });

  test('sends periodic payloads on heartbeat', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for heartbeat (10s on desktop)
    await page.waitForTimeout(11000);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Should have multiple payloads (initial + heartbeat)
    expect(events.length).toBeGreaterThanOrEqual(2);

    // All payloads should have same session_id
    const sessionIds = new Set(events.map((e) => e.payload.session_id));
    expect(sessionIds.size).toBe(1);
  });

  test('tracks goals via trackGoal()', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track goal using the button
    await page.click('#btn-goal');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Find payload with the goal
    const payloadWithGoal = events.find((e) => hasGoal(e.payload, 'signup'));
    expect(payloadWithGoal).toBeTruthy();

    // Check goal details
    const goals = getGoals(payloadWithGoal!.payload);
    expect(goals.length).toBeGreaterThanOrEqual(1);

    const signupGoal = goals.find((g) => g.name === 'signup');
    expect(signupGoal).toBeTruthy();
    expect(signupGoal?.value).toBe(99.99);
  });

  test('tracks custom goals via trackGoal()', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track custom goal using the button (button_click)
    await page.click('#btn-track');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Find payload with the goal
    const payloadWithGoal = events.find((e) => hasGoal(e.payload, 'button_click'));
    expect(payloadWithGoal).toBeTruthy();

    const goals = getGoals(payloadWithGoal!.payload);
    const buttonGoal = goals.find((g) => g.name === 'button_click');
    expect(buttonGoal).toBeTruthy();
    expect(buttonGoal?.properties?.button).toBe('custom');
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

  test('SPA navigation adds to actions array', async ({ page, request }) => {
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for initial payload
    await page.waitForTimeout(500);

    // Navigate to products
    await page.click('text=Products');
    await page.waitForTimeout(500);

    // Navigate to about
    await page.click('text=About');
    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Get the latest payload
    const latestPayload = events[events.length - 1].payload;

    // Should have pageview actions for navigated pages
    // Note: current_page won't be in actions until user leaves that page
    expect(latestPayload.actions.length).toBeGreaterThanOrEqual(1);

    // Check we have pageview actions
    const pageviews = latestPayload.actions.filter((a) => a.type === 'pageview');
    expect(pageviews.length).toBeGreaterThanOrEqual(1);
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

  test('payload includes sdk_version', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(500);

    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload.sdk_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
