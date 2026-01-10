import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Sequential for state-dependent tests
  retries: 1,
  workers: 1,
  reporter: 'html',
  timeout: 30000,

  // Global setup/teardown for ClickHouse database
  globalSetup: './tests/e2e/helpers/global-setup.ts',
  globalTeardown: './tests/e2e/helpers/global-teardown.ts',

  use: {
    baseURL: 'http://localhost:3333',
    trace: 'on-first-retry',
    // Avoid bot detection
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },

  webServer: [
    {
      // Static file server for HTML pages + SDK bundle
      command: 'npx tsx tests/e2e/helpers/static-server.ts',
      url: 'http://localhost:3333/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Real API server for tracking data
      command: 'cd ../api && PORT=4000 CLICKHOUSE_SYSTEM_DATABASE=staminads_sdk_e2e_system npm run start:dev',
      url: 'http://localhost:4000/api/setup.status',
      reuseExistingServer: !process.env.CI,
      timeout: 120000, // API takes longer to start
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Add more browsers later:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    // { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
  ],
});
