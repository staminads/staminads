/**
 * Debug E2E Tests
 *
 * Debug/diagnostics tests for bot detection and SDK initialization.
 */

import { test, expect } from './fixtures';

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
