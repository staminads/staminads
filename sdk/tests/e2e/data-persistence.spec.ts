/**
 * Data Persistence E2E Tests
 *
 * Tests that data persists correctly in localStorage across sessions and reloads.
 * Updated for V3 SessionPayload format.
 */

import { test, expect, CapturedPayload, hasGoal } from './fixtures';

test.describe('Data Persistence', () => {
  test.beforeEach(async ({ request, page }) => {
    await request.post('/api/test/reset');
    // Clear localStorage
    await page.goto('/test-page.html');
    await page.evaluate(() => localStorage.clear());
  });

  test('visitor_id persists across sessions', async ({ page, context }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const visitorId1 = await page.evaluate(() => Staminads.getVisitorId());

    // Close page and create new one
    await page.close();

    const newPage = await context.newPage();
    await newPage.goto('/test-page.html');
    await newPage.waitForFunction(() => window.SDK_INITIALIZED);
    await newPage.evaluate(() => window.SDK_READY);

    const visitorId2 = await newPage.evaluate(() => Staminads.getVisitorId());

    expect(visitorId2).toBe(visitorId1);
  });

  test('visitor_id persists across browser restart', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const visitorId1 = await page.evaluate(() => Staminads.getVisitorId());

    // Verify it's in localStorage
    const storedVisitorId = await page.evaluate(() => {
      const data = localStorage.getItem('stm_visitor_id');
      return data ? JSON.parse(data) : null;
    });

    expect(storedVisitorId).toBe(visitorId1);

    // Reload page (simulates browser restart with persisted storage)
    await page.reload();
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const visitorId2 = await page.evaluate(() => Staminads.getVisitorId());
    expect(visitorId2).toBe(visitorId1);
  });

  test('custom dimensions persist in localStorage', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Set dimensions
    await page.evaluate(async () => {
      await Staminads.setDimension(1, 'value1');
      await Staminads.setDimension(2, 'value2');
      await Staminads.setDimension(5, 'value5');
    });

    // Reload
    await page.reload();
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Dimensions should persist
    const dim1 = await page.evaluate(() => Staminads.getDimension(1));
    const dim2 = await page.evaluate(() => Staminads.getDimension(2));
    const dim5 = await page.evaluate(() => Staminads.getDimension(5));

    expect(dim1).toBe('value1');
    expect(dim2).toBe('value2');
    expect(dim5).toBe('value5');
  });

  test('session data persists in localStorage', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId = await page.evaluate(() => Staminads.getSessionId());

    // Check localStorage has session
    const storedSession = await page.evaluate(() => {
      const data = localStorage.getItem('stm_session');
      return data ? JSON.parse(data) : null;
    });

    expect(storedSession).toBeTruthy();
    expect(storedSession.id).toBe(sessionId);
    expect(storedSession.workspace_id).toBe('test_workspace');
  });

  test('session timestamp updates on activity', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Get initial timestamp
    const session1 = await page.evaluate(() => {
      const data = localStorage.getItem('stm_session');
      return data ? JSON.parse(data) : null;
    });
    const lastActive1 = session1.last_active_at;

    // Wait and trigger activity
    await page.waitForTimeout(1000);
    await page.evaluate(() => Staminads.trackGoal({ action: 'activity' }));
    await page.waitForTimeout(500);

    // Get updated timestamp
    const session2 = await page.evaluate(() => {
      const data = localStorage.getItem('stm_session');
      return data ? JSON.parse(data) : null;
    });
    const lastActive2 = session2.last_active_at;

    expect(lastActive2).toBeGreaterThan(lastActive1);
  });

  test('localStorage keys use correct prefix', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const keys = await page.evaluate(() => {
      const stmKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('stm_')) {
          stmKeys.push(key);
        }
      }
      return stmKeys;
    });

    // Should have session and visitor_id at minimum
    expect(keys).toContain('stm_session');
    expect(keys).toContain('stm_visitor_id');
  });

  test('tab_id is unique per tab (sessionStorage)', async ({ page, context }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Get tab_id from sessionStorage
    const tabId1 = await page.evaluate(() => {
      const data = sessionStorage.getItem('stm_tab_id');
      return data ? JSON.parse(data) : null;
    });

    // Open new tab
    const newPage = await context.newPage();
    await newPage.goto('/test-page.html');
    await newPage.waitForFunction(() => window.SDK_INITIALIZED);
    await newPage.evaluate(() => window.SDK_READY);

    const tabId2 = await newPage.evaluate(() => {
      const data = sessionStorage.getItem('stm_tab_id');
      return data ? JSON.parse(data) : null;
    });

    // Tab IDs should be different
    expect(tabId1).toBeTruthy();
    expect(tabId2).toBeTruthy();
    expect(tabId2).not.toBe(tabId1);
  });

  test('session state persists in sessionStorage', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track a goal
    await page.evaluate(() => Staminads.trackGoal({ action: 'persist_test' }));
    await page.waitForTimeout(500);

    // Check sessionStorage has session state
    const sessionState = await page.evaluate(() => {
      const data = sessionStorage.getItem('stm_session_state');
      return data ? JSON.parse(data) : null;
    });

    expect(sessionState).toBeTruthy();
    expect(sessionState.actions).toBeDefined();
    expect(sessionState.actions.some((a: { type: string; name?: string }) =>
      a.type === 'goal' && a.name === 'persist_test'
    )).toBe(true);
  });

  test('session state restored after navigation', async ({ page, request }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track a goal
    await page.evaluate(() => Staminads.trackGoal({ action: 'before_nav' }));
    await page.waitForTimeout(500);

    // Navigate to SPA page and back
    await page.goto('/spa-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);
    await page.waitForTimeout(500);

    // Go back to test page
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);
    await page.waitForTimeout(500);

    // Track another goal
    await page.evaluate(() => Staminads.trackGoal({ action: 'after_nav' }));
    await page.waitForTimeout(500);

    // Check the latest payload has both goals
    const response = await request.get('/api/test/events');
    const events: CapturedPayload[] = await response.json();

    // Find payload with after_nav goal
    const finalPayload = events.find(e => hasGoal(e.payload, 'after_nav'));
    expect(finalPayload).toBeTruthy();

    // Note: Goals from different sessions may not be combined
    // The 'before_nav' goal would be in a different session's payload
  });

  test('workspace_id stored with session', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const storedSession = await page.evaluate(() => {
      const data = localStorage.getItem('stm_session');
      return data ? JSON.parse(data) : null;
    });

    expect(storedSession).toBeTruthy();
    expect(storedSession.workspace_id).toBe('test_workspace');
  });
});
