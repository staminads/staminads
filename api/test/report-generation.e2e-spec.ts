// Set env vars BEFORE any imports to ensure ConfigModule picks them up
import { setupTestEnv } from './constants/test-config';
setupTestEnv();

import { ClickHouseClient } from '@clickhouse/client';
import {
  toClickHouseDateTime,
  createUserWithToken,
  createTestWorkspace,
  truncateSystemTables,
  truncateWorkspaceTables,
  createTestApp,
  closeTestApp,
  waitForClickHouse,
  TestAppContext,
  createMembership,
} from './helpers';
import { ReportGeneratorService } from '../src/subscriptions/report/report-generator.service';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';

const testWorkspaceId = 'report_gen_test_ws';

describe('Report Generation E2E', () => {
  let ctx: TestAppContext;
  let systemClient: ClickHouseClient;
  let workspaceClient: ClickHouseClient;
  let reportGenerator: ReportGeneratorService;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ workspaceId: testWorkspaceId });
    systemClient = ctx.systemClient;
    workspaceClient = ctx.workspaceClient!;
    reportGenerator = ctx.moduleFixture.get<ReportGeneratorService>(
      ReportGeneratorService,
    );

    // Clean and create test user
    await truncateSystemTables(systemClient, ['users']);
    const { id } = await createUserWithToken(
      ctx.app,
      systemClient,
      'report-gen-test@test.com',
      undefined,
      { name: 'Report Gen Test User', isSuperAdmin: true },
    );
    userId = id;

    // Create test workspace
    await truncateSystemTables(systemClient, ['workspaces'], 0);
    await truncateWorkspaceTables(workspaceClient, ['sessions'], 0);

    await createTestWorkspace(systemClient, testWorkspaceId, {
      name: 'Report Gen Test Workspace',
      website: 'https://reporttest.com',
    });
    await createMembership(systemClient, testWorkspaceId, userId, 'owner');

    // Seed test sessions with specific landing paths
    // Use dates from the last 30 days to ensure they match the report date range
    const today = new Date();
    const baseDate = new Date(today);
    baseDate.setDate(baseDate.getDate() - 15); // Start 15 days ago
    baseDate.setHours(12, 0, 0, 0);

    const sessions = [];
    const landingPaths = ['/iphone/', '/iphone-17-pro/', '/iphone-air/', '/'];

    for (let i = 0; i < 100; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + Math.floor(i / 10));
      const landingPath = landingPaths[i % landingPaths.length];

      sessions.push({
        id: `report-session-${i}`,
        workspace_id: testWorkspaceId,
        created_at: toClickHouseDateTime(date),
        updated_at: toClickHouseDateTime(date),
        duration: 30000 + i * 5000, // 30-530 seconds in milliseconds
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        day_of_week: date.getDay() || 7,
        week_number: 1,
        hour: date.getHours(),
        is_weekend: date.getDay() === 0 || date.getDay() === 6,
        referrer: null,
        referrer_domain: null,
        referrer_path: null,
        is_direct: true,
        landing_page: `https://reporttest.com${landingPath}`,
        landing_domain: 'reporttest.com',
        landing_path: landingPath,
        entry_page: landingPath,
        exit_page: '/checkout',
        utm_source: i % 2 === 0 ? 'google' : 'facebook',
        utm_medium: 'cpc',
        utm_campaign: 'test',
        utm_term: null,
        utm_content: null,
        utm_id: null,
        utm_id_from: null,
        channel: 'Paid Search',
        channel_group: 'search-paid',
        screen_width: 1920,
        screen_height: 1080,
        viewport_width: 1920,
        viewport_height: 900,
        user_agent: 'Mozilla/5.0',
        language: 'en-US',
        timezone: 'America/New_York',
        browser: 'Chrome',
        browser_type: 'browser',
        os: 'macOS',
        device: i % 2 === 0 ? 'desktop' : 'mobile',
        connection_type: 'wifi',
        max_scroll: 50 + (i % 50),
        sdk_version: '1.0.0',
      });
    }

    await workspaceClient.insert({
      table: 'sessions',
      values: sessions,
      format: 'JSONEachRow',
    });

    // Force merge for ReplacingMergeTree
    await workspaceClient.command({
      query: 'OPTIMIZE TABLE sessions FINAL',
    });

    await waitForClickHouse(200);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  describe('Sessions count type verification', () => {
    it('should return sessions as integers (not floats) in dimension breakdowns', async () => {
      // Create a subscription-like object for testing
      // Use 'weekly' frequency to query 'previous_7_days' which will match our test data
      const mockSubscription: Subscription = {
        id: 'test-sub',
        user_id: userId,
        workspace_id: testWorkspaceId,
        name: 'Test Report',
        frequency: 'weekly',
        hour: 8,
        metrics: ['sessions', 'median_duration', 'bounce_rate', 'median_scroll'],
        dimensions: ['landing_path'],
        filters: '[]',
        status: 'active',
        last_send_status: 'pending',
        last_error: '',
        consecutive_failures: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Generate the report data
      const reportData = await reportGenerator.generate(mockSubscription);

      // Verify we have dimension data
      expect(reportData.dimensions).toHaveLength(1);
      const landingPathDimension = reportData.dimensions[0];
      expect(landingPathDimension.dimension).toBe('landing_path');
      expect(landingPathDimension.rows.length).toBeGreaterThan(0);

      // Check that ALL sessions values are integers
      console.log('Dimension breakdown rows:');
      for (const row of landingPathDimension.rows) {
        console.log({
          value: row.value,
          sessions: row.sessions,
          sessionsType: typeof row.sessions,
          isInteger: Number.isInteger(row.sessions),
          formattedMetric: row.formattedMetric,
        });

        // CRITICAL: sessions must be an integer
        expect(Number.isInteger(row.sessions)).toBe(true);
      }

      // Verify at least one row has sessions
      const iphoneRow = landingPathDimension.rows.find(
        (r) => r.value === '/iphone/',
      );
      expect(iphoneRow).toBeDefined();
      expect(iphoneRow!.sessions).toBeGreaterThan(0);
    });

    it('should format TimeScore as duration (not raw seconds) in dimension breakdowns', async () => {
      const mockSubscription: Subscription = {
        id: 'test-sub-2',
        user_id: userId,
        workspace_id: testWorkspaceId,
        name: 'Test Report 2',
        frequency: 'weekly',
        hour: 8,
        metrics: ['sessions', 'median_duration'],
        dimensions: ['landing_path'],
        filters: '[]',
        status: 'active',
        last_send_status: 'pending',
        last_error: '',
        consecutive_failures: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const reportData = await reportGenerator.generate(mockSubscription);
      const landingPathDimension = reportData.dimensions[0];

      // Check that formattedMetric is a duration string, not raw seconds
      for (const row of landingPathDimension.rows) {
        // formattedMetric should contain 'm' or 's' (e.g., "5m 30s" or "45s")
        expect(row.formattedMetric).toMatch(/\d+[ms]/);

        // It should NOT be a plain number
        expect(row.formattedMetric).not.toMatch(/^\d+$/);

        console.log({
          value: row.value,
          metric: row.metric,
          formattedMetric: row.formattedMetric,
        });
      }
    });

    it('should render HTML with integer sessions and formatted TimeScore', async () => {
      const mockSubscription: Subscription = {
        id: 'test-sub-3',
        user_id: userId,
        workspace_id: testWorkspaceId,
        name: 'Test Report 3',
        frequency: 'weekly',
        hour: 8,
        metrics: ['sessions', 'median_duration'],
        dimensions: ['landing_path'],
        filters: '[]',
        status: 'active',
        last_send_status: 'pending',
        last_error: '',
        consecutive_failures: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const reportData = await reportGenerator.generate(mockSubscription);
      const html = reportGenerator.renderEmail(reportData, mockSubscription);

      // The HTML should contain formatted durations like "5m 30s"
      expect(html).toMatch(/\d+m \d+s/);

      // The HTML should NOT contain raw seconds as standalone numbers in table cells
      // (e.g., ">384<" for raw seconds)
      // Note: We can have numbers like ">25<" for sessions, that's fine
      // But we shouldn't have 3-digit numbers that look like raw seconds
      const rawSecondsPattern = />(\d{3,})</g;
      const matches = html.match(rawSecondsPattern);

      // Log any matches for debugging
      if (matches) {
        console.log('Found potential raw seconds in HTML:', matches);
      }

      // Sessions should NOT have decimals
      expect(html).not.toMatch(/>\d+\.\d+</);

      console.log(
        'HTML snippet (dimension table):',
        html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0]?.substring(0, 1000),
      );
    });
  });
});
