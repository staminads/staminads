/**
 * Custom Playwright fixtures for E2E tests
 *
 * Includes stealth mode to bypass SDK bot detection.
 */

import { test as base, expect, devices } from '@playwright/test';

const stealthScript = `
  // Delete webdriver property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // Ensure plugins exist (Chrome-like)
  if (!navigator.plugins || navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
  }

  // Ensure languages exist
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  }

  // Add chrome object if missing
  if (!window.chrome) {
    window.chrome = {
      runtime: {},
    };
  }
`;

// Extend base test to auto-apply stealth script
export const test = base.extend({
  page: async ({ page }, use) => {
    // Add stealth script before each navigation
    await page.addInitScript(stealthScript);
    await use(page);
  },
});

export { expect, devices };
