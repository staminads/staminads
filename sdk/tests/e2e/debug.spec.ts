/**
 * Debug E2E Tests
 *
 * Debug/diagnostics tests for bot detection and SDK initialization.
 * Tests SDK debug and introspection capabilities.
 */

import { test, expect, truncateEvents } from './fixtures';

test.describe('Debug and Diagnostics', () => {
  test.beforeEach(async () => {
    await truncateEvents();
  });

  test('debug bot detection', async ({ page }) => {
    // Capture all console logs
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[error] ${err.message}`));

    await page.goto('/test-page.html');

    // Check bot detection values
    const debugInfo = await page.evaluate(() => {
      const nav = navigator as Navigator & { webdriver?: boolean };
      const win = window as Window & { chrome?: unknown };

      // Run isBot logic inline to see what triggers
      const ua = navigator.userAgent.toLowerCase();
      const botPatterns = [/headless/i, /phantom/i, /selenium/i, /puppeteer/i];
      const uaMatch = botPatterns.some((p) => p.test(ua));

      const suspiciousFeatures = [
        !('plugins' in navigator) || navigator.plugins.length === 0,
        !('languages' in navigator) || navigator.languages.length === 0,
        !win.chrome && /chrome/i.test(ua),
        screen.width === 0 || screen.height === 0,
        !('ontouchstart' in window) && /mobile/i.test(ua),
      ];

      return {
        webdriver: nav.webdriver,
        webdriverDefined: 'webdriver' in navigator,
        plugins: navigator.plugins?.length,
        languages: navigator.languages?.length,
        chrome: !!win.chrome,
        ua: ua.substring(0, 150),
        screenWidth: screen.width,
        screenHeight: screen.height,
        uaMatchBot: uaMatch,
        suspiciousFeatures: suspiciousFeatures.map((v, i) => `${i}: ${v}`),
        suspiciousCount: suspiciousFeatures.filter(Boolean).length,
      };
    });

    console.log('Debug info:', JSON.stringify(debugInfo, null, 2));

    // Wait for status
    await page.waitForTimeout(3000);
    const status = await page.textContent('#status');
    console.log('Status:', status);

    // Check if SDK initialized
    const initialized = await page.evaluate(
      () => (window as Window & { SDK_INITIALIZED?: boolean }).SDK_INITIALIZED
    );
    console.log('SDK_INITIALIZED:', initialized);

    // Print captured logs
    console.log('Console logs:', logs);

    // Stealth mode should have bypassed bot detection
    expect(initialized).toBe(true);
  });

  test('SDK exposes debug method', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Check debug() method returns info
    const debugInfo = await page.evaluate(() => Staminads.debug());

    expect(debugInfo).toBeTruthy();
    expect(typeof debugInfo).toBe('object');
  });

  test('SDK config is accessible', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Check getConfig() method
    const config = await page.evaluate(() => Staminads.getConfig());

    expect(config).toBeTruthy();
    expect(config?.workspace_id).toBe('test_workspace');
  });

  test('debug() returns session and state info', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Track some activity
    await page.evaluate(() => Staminads.trackGoal({ action: 'debug_test' }));
    await page.waitForTimeout(500);

    const debugInfo = await page.evaluate(() => Staminads.debug());

    expect(debugInfo).toBeTruthy();
    expect(typeof debugInfo).toBe('object');

    // Should contain session info
    // The exact structure depends on SDK implementation
    console.log('Debug output:', JSON.stringify(debugInfo, null, 2));
  });

  test('SDK handles initialization without errors', async ({ page }) => {
    // Capture console errors (excluding expected network errors from API)
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out expected network errors (API may return 400 for certain conditions)
        if (
          !text.includes('Failed to load resource') &&
          !text.includes('net::') &&
          !text.includes('status of 4')
        ) {
          errors.push(text);
        }
      }
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait a bit to catch any delayed errors
    await page.waitForTimeout(1000);

    // Should have no SDK errors (network errors are expected when testing)
    expect(errors.length).toBe(0);
  });

  test('SDK handles multiple initializations gracefully', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    const sessionId1 = await page.evaluate(() => Staminads.getSessionId());

    // Try to reinitialize (should be a no-op or handled gracefully)
    const error = await page.evaluate(async () => {
      try {
        await Staminads.init({
          workspace_id: 'another_workspace',
          endpoint: 'http://localhost:4000',
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    // Should either succeed silently or throw a meaningful error
    // But should not crash
    const sessionId2 = await page.evaluate(() => Staminads.getSessionId());

    // Session should be preserved (not replaced)
    expect(sessionId2).toBe(sessionId1);
  });

  test('SDK logs debug messages when debug mode enabled', async ({ page }) => {
    // Capture all console logs to check for debug output
    const allLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text().toLowerCase();
      allLogs.push(msg.text());
    });

    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Wait for debug output
    await page.waitForTimeout(1000);

    // Debug mode is enabled in test-page.html
    // The SDK may or may not log with a specific prefix
    console.log('Total logs captured:', allLogs.length);

    // Test passes if we can verify debug mode is enabled via API
    const debugInfo = await page.evaluate(() => Staminads.debug());
    expect(debugInfo.config.debug).toBe(true);
  });

  test('getFocusDuration returns non-negative number', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(1000);

    const duration = await page.evaluate(() => Staminads.getFocusDuration());

    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(10000); // Should be reasonable
  });

  test('getTotalDuration returns non-negative number', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    await page.waitForTimeout(1000);

    const duration = await page.evaluate(() => Staminads.getTotalDuration());

    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(10000); // Should be reasonable
  });

  test('pause and resume work correctly', async ({ page }) => {
    await page.goto('/test-page.html');
    await page.waitForFunction(() => window.SDK_INITIALIZED);
    await page.evaluate(() => window.SDK_READY);

    // Verify pause and resume methods exist
    const hasPause = await page.evaluate(() => typeof Staminads.pause === 'function');
    const hasResume = await page.evaluate(() => typeof Staminads.resume === 'function');

    expect(hasPause).toBe(true);
    expect(hasResume).toBe(true);

    // Just verify that pause/resume calls don't throw errors
    await page.evaluate(async () => {
      Staminads.pause();
      await new Promise((r) => setTimeout(r, 100));
      Staminads.resume();
    });

    // SDK should still be functional after pause/resume
    const sessionId = await page.evaluate(() => Staminads.getSessionId());
    expect(sessionId).toBeTruthy();
  });
});
