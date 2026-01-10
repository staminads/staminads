/**
 * Playwright global teardown for SDK E2E tests
 *
 * Cleans up test databases after all tests complete.
 */

import { cleanupTestDatabases } from './clickhouse';

async function globalTeardown(): Promise<void> {
  console.log('\n[Global Teardown] Cleaning up SDK E2E test databases...');
  await cleanupTestDatabases();
  console.log('[Global Teardown] Done.\n');
}

export default globalTeardown;
