import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Sequential for state-dependent tests
  retries: 1,
  workers: 1,
  reporter: 'html',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3333',
    trace: 'on-first-retry',
    // Avoid bot detection
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },
  webServer: {
    command: 'npx tsx tests/e2e/helpers/mock-server.ts',
    url: 'http://localhost:3333/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Add more browsers later:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    // { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
  ],
});
