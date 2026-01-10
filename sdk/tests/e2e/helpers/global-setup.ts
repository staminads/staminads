/**
 * Playwright global setup for SDK E2E tests
 *
 * Creates test databases and workspace before any tests run.
 */

import { initializeTestDatabases } from './clickhouse';

async function globalSetup(): Promise<void> {
  console.log('\n[Global Setup] Initializing SDK E2E test databases...');
  await initializeTestDatabases();
  console.log('[Global Setup] Done.\n');
}

export default globalSetup;
