/**
 * Data Persistence E2E Tests
 *
 * Tests that data persists correctly in localStorage across sessions and reloads.
 */

import { test, expect } from './fixtures';

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
    await page.evaluate(() => {
      Staminads.setDimension(1, 'value1');
      Staminads.setDimension(2, 'value2');
      Staminads.setDimension(5, 'value5');
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

  test('queue persists after failed send', async ({ page, request }) => {
    // Disable sendBeacon - it doesn't report server errors (fire-and-forget)
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    // Configure server to fail
    await request.post('/api/test/fail');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event (will fail and queue)
    await page.evaluate(() => Staminads.trackEvent('failed_event'));
    await page.waitForTimeout(1000);

    // Check queue in localStorage
    const queue = await page.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });

    expect(queue.length).toBeGreaterThanOrEqual(1);
  });

  test('queue flushes on page revisit', async ({ page, request, context }) => {
    // Disable sendBeacon on first page - it doesn't report server errors
    await page.addInitScript(() => {
      // @ts-expect-error - Mocking navigator
      navigator.sendBeacon = () => false;
    });

    // Configure server to fail
    await request.post('/api/test/fail');

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track event (will fail and queue since sendBeacon disabled)
    await page.evaluate(() => Staminads.trackEvent('queued_event'));
    await page.waitForTimeout(1000);

    // Verify queue has items
    const queueBefore = await page.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });
    expect(queueBefore.length).toBeGreaterThanOrEqual(1);

    // Fix server
    await request.post('/api/test/succeed');

    // Close and reopen page (new page has normal sendBeacon for flush)
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/test-page.html');
    await newPage.waitForFunction(() => window.SDK_INITIALIZED);
    await newPage.evaluate(() => window.SDK_READY);

    // Wait for queue flush
    await newPage.waitForTimeout(2000);

    // Queue should be empty now
    const queueAfter = await newPage.evaluate(() => {
      const data = localStorage.getItem('stm_pending');
      return data ? JSON.parse(data) : [];
    });

    expect(queueAfter.length).toBe(0);
  });

  test('session timestamp updates correctly', async ({ page }) => {
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
    await page.evaluate(() => Staminads.track('activity'));
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
    const tabId1 = await page.evaluate(() => sessionStorage.getItem('stm_tab_id'));

    // Open new tab
    const newPage = await context.newPage();
    await newPage.goto('/test-page.html');
    await newPage.waitForFunction(() => window.SDK_INITIALIZED);
    await newPage.evaluate(() => window.SDK_READY);

    const tabId2 = await newPage.evaluate(() => sessionStorage.getItem('stm_tab_id'));

    // Tab IDs should be different
    expect(tabId1).toBeTruthy();
    expect(tabId2).toBeTruthy();
    expect(tabId2).not.toBe(tabId1);
  });
});

// TypeScript declarations
declare global {
  interface Window {
    SDK_READY: Promise<void>;
    Staminads: {
      getSessionId: () => string;
      getVisitorId: () => string;
      track: (name: string, data?: Record<string, unknown>) => void;
      setDimension: (index: number, value: string) => void;
      getDimension: (index: number) => string | null;
    };
  }
  const Staminads: Window['Staminads'];
}
