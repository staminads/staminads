import { ClickHouseClient, createClient } from '@clickhouse/client';
import { V3Migration } from './v3.migration';

/**
 * V3 Migration Integration Tests
 *
 * These tests require a running ClickHouse instance.
 * Skip in CI if ClickHouse is not available.
 */
describe('V3Migration', () => {
  let client: ClickHouseClient;
  let migration: V3Migration;
  const workspaceDb = 'test_ws_v3_migration';

  // Helper to format date for ClickHouse DateTime64(3)
  const toClickHouseDate = (date: Date = new Date()) =>
    date.toISOString().replace('T', ' ').replace('Z', '');

  // Helper to create test event with all required fields
  const createTestEvent = (overrides: Record<string, unknown> = {}) => {
    const now = toClickHouseDate();
    return {
      session_id: 'test-session',
      workspace_id: 'test-ws',
      name: 'screen_view',
      path: '/test',
      landing_page: 'https://example.com/',
      landing_path: '/',
      landing_domain: 'example.com',
      previous_path: '',
      referrer: '',
      referrer_domain: '',
      referrer_path: '',
      received_at: now,
      created_at: now,
      updated_at: now,
      page_duration: 0,
      page_number: 1,
      goal_name: '',
      goal_value: 0,
      ...overrides,
    };
  };

  // Helper to get table columns
  async function getTableColumns(
    database: string,
    table: string,
  ): Promise<
    Array<{ name: string; type: string; default_expression: string }>
  > {
    const result = await client.query({
      query: `
        SELECT name, type, default_expression
        FROM system.columns
        WHERE database = '${database}' AND table = '${table}'
      `,
    });
    const { data } = (await result.json()) as {
      data: Array<{ name: string; type: string; default_expression: string }>;
    };
    return data;
  }

  beforeAll(async () => {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    });
    migration = new V3Migration();

    // Create test database
    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${workspaceDb}`,
    });

    // Create base tables with v2 schema (simulating pre-migration state)
    // Events table without new columns
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${workspaceDb}.events (
          id UUID DEFAULT generateUUIDv4(),
          session_id String,
          workspace_id String,
          received_at DateTime64(3),
          created_at DateTime64(3),
          updated_at DateTime64(3),
          name LowCardinality(String),
          path String,
          duration UInt64 DEFAULT 0,
          previous_path String DEFAULT '',
          referrer String DEFAULT '',
          referrer_domain String DEFAULT '',
          referrer_path String DEFAULT '',
          is_direct Bool DEFAULT false,
          landing_page String,
          landing_domain String DEFAULT '',
          landing_path String DEFAULT '',
          utm_source String DEFAULT '',
          utm_medium String DEFAULT '',
          utm_campaign String DEFAULT '',
          utm_term String DEFAULT '',
          utm_content String DEFAULT '',
          utm_id String DEFAULT '',
          utm_id_from String DEFAULT '',
          channel LowCardinality(String) DEFAULT '',
          channel_group LowCardinality(String) DEFAULT '',
          stm_1 String DEFAULT '',
          stm_2 String DEFAULT '',
          stm_3 String DEFAULT '',
          stm_4 String DEFAULT '',
          stm_5 String DEFAULT '',
          stm_6 String DEFAULT '',
          stm_7 String DEFAULT '',
          stm_8 String DEFAULT '',
          stm_9 String DEFAULT '',
          stm_10 String DEFAULT '',
          screen_width UInt16 DEFAULT 0,
          screen_height UInt16 DEFAULT 0,
          viewport_width UInt16 DEFAULT 0,
          viewport_height UInt16 DEFAULT 0,
          device String DEFAULT '',
          browser String DEFAULT '',
          browser_type String DEFAULT '',
          os String DEFAULT '',
          user_agent String DEFAULT '',
          connection_type String DEFAULT '',
          language String DEFAULT '',
          timezone String DEFAULT '',
          country LowCardinality(String) DEFAULT '',
          region LowCardinality(String) DEFAULT '',
          city String DEFAULT '',
          latitude Nullable(Float32),
          longitude Nullable(Float32),
          max_scroll UInt8 DEFAULT 0,
          page_duration UInt32 DEFAULT 0,
          sdk_version String DEFAULT '',
          properties Map(String, String) DEFAULT map(),
          INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_browser_type browser_type TYPE set(10) GRANULARITY 1
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMMDD(received_at)
        ORDER BY (session_id, received_at)
        TTL toDateTime(received_at) + INTERVAL 7 DAY
      `,
    });

    // Sessions table without new columns
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${workspaceDb}.sessions (
          id String,
          workspace_id String,
          created_at DateTime64(3),
          updated_at DateTime64(3),
          duration UInt32 DEFAULT 0,
          pageview_count UInt16 DEFAULT 1,
          median_page_duration UInt32 DEFAULT 0,
          year UInt16,
          month UInt8,
          day UInt8,
          day_of_week UInt8,
          week_number UInt8,
          hour UInt8,
          is_weekend Bool,
          referrer String DEFAULT '',
          referrer_domain String DEFAULT '',
          referrer_path String DEFAULT '',
          is_direct Bool,
          landing_page String,
          landing_domain String DEFAULT '',
          landing_path String DEFAULT '',
          exit_path String DEFAULT '',
          utm_source String DEFAULT '',
          utm_medium String DEFAULT '',
          utm_campaign String DEFAULT '',
          utm_term String DEFAULT '',
          utm_content String DEFAULT '',
          utm_id String DEFAULT '',
          utm_id_from String DEFAULT '',
          channel LowCardinality(String) DEFAULT '',
          channel_group LowCardinality(String) DEFAULT '',
          stm_1 String DEFAULT '',
          stm_2 String DEFAULT '',
          stm_3 String DEFAULT '',
          stm_4 String DEFAULT '',
          stm_5 String DEFAULT '',
          stm_6 String DEFAULT '',
          stm_7 String DEFAULT '',
          stm_8 String DEFAULT '',
          stm_9 String DEFAULT '',
          stm_10 String DEFAULT '',
          screen_width UInt16 DEFAULT 0,
          screen_height UInt16 DEFAULT 0,
          viewport_width UInt16 DEFAULT 0,
          viewport_height UInt16 DEFAULT 0,
          user_agent String DEFAULT '',
          language String DEFAULT '',
          timezone String DEFAULT '',
          country LowCardinality(String) DEFAULT '',
          region LowCardinality(String) DEFAULT '',
          city String DEFAULT '',
          latitude Nullable(Float32),
          longitude Nullable(Float32),
          browser String DEFAULT '',
          browser_type String DEFAULT '',
          os String DEFAULT '',
          device String DEFAULT '',
          connection_type String DEFAULT '',
          max_scroll UInt8 DEFAULT 0,
          sdk_version String DEFAULT '',
          INDEX idx_created_at created_at TYPE minmax GRANULARITY 1
        ) ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (created_at, id)
      `,
    });

    // Pages table with UInt8 page_number (pre-migration)
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${workspaceDb}.pages (
          id UUID DEFAULT generateUUIDv4(),
          session_id String,
          workspace_id String,
          path String,
          full_url String DEFAULT '',
          entered_at DateTime64(3),
          exited_at DateTime64(3),
          duration UInt32 DEFAULT 0,
          max_scroll UInt8 DEFAULT 0,
          page_number UInt8 DEFAULT 1,
          is_landing Bool DEFAULT false,
          is_exit Bool DEFAULT false,
          entry_type LowCardinality(String) DEFAULT 'navigation',
          received_at DateTime64(3) DEFAULT now64(3)
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMMDD(received_at)
        ORDER BY (session_id, entered_at)
        TTL toDateTime(received_at) + INTERVAL 7 DAY
      `,
    });
  });

  afterAll(async () => {
    await client.command({ query: `DROP DATABASE IF EXISTS ${workspaceDb}` });
    await client.close();
  });

  beforeEach(async () => {
    // Clear tables between tests
    await client.command({ query: `TRUNCATE TABLE ${workspaceDb}.events` });
    await client.command({ query: `TRUNCATE TABLE ${workspaceDb}.sessions` });
    await client.command({ query: `TRUNCATE TABLE ${workspaceDb}.pages` });
  });

  describe('Events Table', () => {
    it('adds page_number column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'events');
      const pageNumberCol = columns.find((c) => c.name === 'page_number');

      expect(pageNumberCol).toBeDefined();
      expect(pageNumberCol?.type).toBe('UInt16');
      expect(pageNumberCol?.default_expression).toBe('0');
    });

    it('adds _version column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'events');
      const versionCol = columns.find((c) => c.name === '_version');

      expect(versionCol).toBeDefined();
      expect(versionCol?.type).toBe('UInt64');
      expect(versionCol?.default_expression).toBe('0');
    });

    it('adds goal_name column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'events');
      const goalNameCol = columns.find((c) => c.name === 'goal_name');

      expect(goalNameCol).toBeDefined();
      expect(goalNameCol?.type).toBe('String');
      expect(goalNameCol?.default_expression).toBe("''");
    });

    it('adds goal_value column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'events');
      const goalValueCol = columns.find((c) => c.name === 'goal_value');

      expect(goalValueCol).toBeDefined();
      expect(goalValueCol?.type).toBe('Float32');
      expect(goalValueCol?.default_expression).toBe('0');
    });

    it('adds dedup_token column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'events');
      const dedupTokenCol = columns.find((c) => c.name === 'dedup_token');

      expect(dedupTokenCol).toBeDefined();
      expect(dedupTokenCol?.type).toBe('String');
      expect(dedupTokenCol?.default_expression).toBe("''");
    });
  });

  describe('Sessions Table', () => {
    it('adds goal_count column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'sessions');
      const goalCountCol = columns.find((c) => c.name === 'goal_count');

      expect(goalCountCol).toBeDefined();
      expect(goalCountCol?.type).toBe('UInt16');
      expect(goalCountCol?.default_expression).toBe('0');
    });

    it('adds goal_value column with correct type and default', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'sessions');
      const goalValueCol = columns.find((c) => c.name === 'goal_value');

      expect(goalValueCol).toBeDefined();
      expect(goalValueCol?.type).toBe('Float32');
      expect(goalValueCol?.default_expression).toBe('0');
    });
  });

  describe('Pages Table', () => {
    it('has page_number as UInt16 (not UInt8)', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'pages');
      const pageNumberCol = columns.find((c) => c.name === 'page_number');

      expect(pageNumberCol?.type).toBe('UInt16');
    });
  });

  describe('Idempotency', () => {
    it('can run multiple times without error', async () => {
      // Run migration twice
      await migration.migrateWorkspace(client, workspaceDb);
      await expect(
        migration.migrateWorkspace(client, workspaceDb),
      ).resolves.not.toThrow();
    });

    it('preserves existing data after re-run', async () => {
      // Run migration first to ensure columns exist
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert test event with all required fields
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 'test-session-data',
            path: '/preserved',
          }),
        ],
        format: 'JSONEachRow',
      });

      // Run migration again
      await migration.migrateWorkspace(client, workspaceDb);

      // Verify data still exists
      const result = await client.query({
        query: `SELECT * FROM ${workspaceDb}.events WHERE session_id = 'test-session-data'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ path: string }>;
      };

      expect(rows).toHaveLength(1);
      expect(rows[0].path).toBe('/preserved');
    });
  });

  describe('Sessions MV', () => {
    it('aggregates goal_count from events', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert goal events with all required fields
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's1',
            name: 'goal',
            goal_name: 'signup',
          }),
          createTestEvent({
            session_id: 's1',
            name: 'goal',
            goal_name: 'purchase',
          }),
          createTestEvent({
            session_id: 's1',
            name: 'screen_view',
            path: '/home',
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ goal_count: number }>;
      };

      expect(rows[0].goal_count).toBe(2);
    });

    it('sums goal_value from events', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert goal events with values
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's1',
            name: 'goal',
            goal_name: 'purchase',
            goal_value: 99.99,
          }),
          createTestEvent({
            session_id: 's1',
            name: 'goal',
            goal_name: 'upsell',
            goal_value: 29.99,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT goal_value FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ goal_value: number }>;
      };

      expect(rows[0].goal_value).toBeCloseTo(129.98, 2);
    });

    it('goal events do not inflate pageview_count', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert mix of screen_view and goal events
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's1',
            name: 'screen_view',
            path: '/home',
          }),
          createTestEvent({
            session_id: 's1',
            name: 'screen_view',
            path: '/about',
          }),
          createTestEvent({
            session_id: 's1',
            name: 'goal',
            goal_name: 'signup',
          }),
          createTestEvent({
            session_id: 's1',
            name: 'goal',
            goal_name: 'purchase',
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT pageview_count, goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ pageview_count: number; goal_count: number }>;
      };

      expect(rows[0].pageview_count).toBe(2); // Only screen_view events
      expect(rows[0].goal_count).toBe(2); // Only goal events
    });
  });

  describe('Pages MV', () => {
    it('uses page_number from events instead of hardcoded 1', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert event with explicit page_number
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's1',
            name: 'screen_view',
            path: '/checkout',
            page_number: 5,
            page_duration: 30000, // 30 seconds in ms
            previous_path: '/cart',
            landing_path: '/home',
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_number FROM ${workspaceDb}.pages WHERE session_id = 's1'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ page_number: number }>;
      };

      expect(rows[0].page_number).toBe(5);
    });

    it('page_number supports values > 255 (UInt16)', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert event with page_number > 255 (requires UInt16)
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's2',
            name: 'screen_view',
            path: '/page-300',
            page_number: 300,
            page_duration: 15000,
            previous_path: '/page-299',
            landing_path: '/home',
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_number FROM ${workspaceDb}.pages WHERE session_id = 's2'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ page_number: number }>;
      };

      expect(rows[0].page_number).toBe(300); // Would fail if UInt8
    });
  });

  // === Phase 4 Tests: Pages Table Recreation ===
  describe('Phase 4 - Pages Table Engine', () => {
    it('has ReplacingMergeTree engine with _version', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const result = await client.query({
        query: `
          SELECT engine, engine_full
          FROM system.tables
          WHERE database = '${workspaceDb}' AND name = 'pages'
        `,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ engine: string; engine_full: string }>;
      };

      expect(rows[0].engine).toBe('ReplacingMergeTree');
      expect(rows[0].engine_full).toContain('_version');
    });

    it('has ORDER BY (session_id, page_number)', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const result = await client.query({
        query: `
          SELECT sorting_key
          FROM system.tables
          WHERE database = '${workspaceDb}' AND name = 'pages'
        `,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ sorting_key: string }>;
      };

      expect(rows[0].sorting_key).toBe('session_id, page_number');
    });
  });

  describe('Phase 4 - Pages Table Columns', () => {
    it('has page_id String column', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'pages');
      const pageIdCol = columns.find((c) => c.name === 'page_id');

      expect(pageIdCol).toBeDefined();
      expect(pageIdCol?.type).toBe('String');
    });

    it('has _version UInt64 column', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const columns = await getTableColumns(workspaceDb, 'pages');
      const versionCol = columns.find((c) => c.name === '_version');

      expect(versionCol).toBeDefined();
      expect(versionCol?.type).toBe('UInt64');
    });
  });

  describe('Phase 4 - Pages MV page_id generation', () => {
    it('generates page_id from session_id and page_number', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 'sess-abc',
            page_number: 5,
            path: '/checkout',
            page_duration: 8000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_id, path FROM ${workspaceDb}.pages WHERE session_id = 'sess-abc'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ page_id: string; path: string }>;
      };

      expect(rows[0].page_id).toBe('sess-abc_5');
      expect(rows[0].path).toBe('/checkout');
    });

    it('same session_id + page_number produces same page_id', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert same page twice (simulating cumulative payload) - separate inserts
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 'sess-xyz',
            page_number: 3,
            page_duration: 5000,
            max_scroll: 30,
            _version: 1000,
          }),
        ],
        format: 'JSONEachRow',
      });
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 'sess-xyz',
            page_number: 3,
            page_duration: 10000,
            max_scroll: 75,
            _version: 2000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_id, count() as cnt FROM ${workspaceDb}.pages WHERE session_id = 'sess-xyz' GROUP BY page_id`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ page_id: string; cnt: string }>;
      };

      expect(rows).toHaveLength(1);
      expect(rows[0].page_id).toBe('sess-xyz_3');
      expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(1); // At least one row with this page_id
    });
  });

  describe('Phase 4 - Pages deduplication', () => {
    it('FINAL returns latest version for same page_id', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Insert same page twice with different versions (separate inserts for ClickHouse)
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 'sess-dedup',
            page_number: 2,
            page_duration: 5000,
            max_scroll: 30,
            _version: 1704067200000,
          }),
        ],
        format: 'JSONEachRow',
      });
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 'sess-dedup',
            page_number: 2,
            page_duration: 15000,
            max_scroll: 85,
            _version: 1704067260000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `
          SELECT page_id, duration, max_scroll, _version
          FROM ${workspaceDb}.pages FINAL
          WHERE session_id = 'sess-dedup'
        `,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{
          page_id: string;
          duration: number;
          max_scroll: number;
          _version: string;
        }>;
      };

      expect(rows).toHaveLength(1);
      expect(rows[0].page_id).toBe('sess-dedup_2');
      expect(rows[0].duration).toBe(15000);
      expect(rows[0].max_scroll).toBe(85);
      expect(Number(rows[0]._version)).toBe(1704067260000);
    });

    it('different page_numbers create separate rows', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's1',
            page_number: 1,
            path: '/home',
            page_duration: 5000,
          }),
          createTestEvent({
            session_id: 's1',
            page_number: 2,
            path: '/about',
            page_duration: 3000,
          }),
          createTestEvent({
            session_id: 's1',
            page_number: 3,
            path: '/contact',
            page_duration: 2000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_id, path FROM ${workspaceDb}.pages FINAL WHERE session_id = 's1' ORDER BY page_number`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ page_id: string; path: string }>;
      };

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.page_id)).toEqual(['s1_1', 's1_2', 's1_3']);
      expect(rows.map((r) => r.path)).toEqual(['/home', '/about', '/contact']);
    });

    it('first page (page_number=1) is included in V3', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // In V2, first page was excluded via previous_path='' check
      // In V3, first page should be included
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's-first',
            page_number: 1,
            path: '/landing',
            previous_path: '', // First page has no previous
            page_duration: 10000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_id, path FROM ${workspaceDb}.pages WHERE session_id = 's-first'`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ page_id: string; path: string }>;
      };

      expect(rows).toHaveLength(1);
      expect(rows[0].path).toBe('/landing'); // First page included!
    });
  });

  describe('Phase 4 - Pages MV _version', () => {
    it('passes _version from events to pages', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      const version = 1704067200000;
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            _version: version,
            page_duration: 5000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT _version FROM ${workspaceDb}.pages`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ _version: string }>;
      };

      expect(Number(rows[0]._version)).toBe(version);
    });
  });

  describe('Phase 4 - Pages MV filtering', () => {
    it('detects landing page correctly', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's-landing',
            page_number: 1,
            path: '/products',
            landing_path: '/products',
            page_duration: 5000,
          }),
          createTestEvent({
            session_id: 's-landing',
            page_number: 2,
            path: '/checkout',
            landing_path: '/products',
            page_duration: 3000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT page_number, path, is_landing FROM ${workspaceDb}.pages FINAL WHERE session_id = 's-landing' ORDER BY page_number`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{
          page_number: number;
          path: string;
          is_landing: boolean | number;
        }>;
      };

      expect(Boolean(rows[0].is_landing)).toBe(true); // /products is landing
      expect(Boolean(rows[1].is_landing)).toBe(false); // /checkout is not landing
    });

    it('excludes events with page_duration=0', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's-zero',
            page_number: 1,
            path: '/a',
            page_duration: 5000,
          }),
          createTestEvent({
            session_id: 's-zero',
            page_number: 2,
            path: '/b',
            page_duration: 0,
          }), // Should be excluded
          createTestEvent({
            session_id: 's-zero',
            page_number: 3,
            path: '/c',
            page_duration: 3000,
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT path FROM ${workspaceDb}.pages WHERE session_id = 's-zero' ORDER BY page_number`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ path: string }>;
      };

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.path)).toEqual(['/a', '/c']); // /b excluded
    });

    it('goal events do not create pages rows', async () => {
      await migration.migrateWorkspace(client, workspaceDb);

      // Goals have page_duration=0 set by server handler, so they should be excluded
      await client.insert({
        table: `${workspaceDb}.events`,
        values: [
          createTestEvent({
            session_id: 's-goals',
            page_number: 1,
            name: 'screen_view',
            path: '/home',
            page_duration: 5000,
          }),
          createTestEvent({
            session_id: 's-goals',
            page_number: 1,
            name: 'goal',
            path: '/home',
            page_duration: 0,
            goal_name: 'signup',
          }),
          createTestEvent({
            session_id: 's-goals',
            page_number: 2,
            name: 'screen_view',
            path: '/checkout',
            page_duration: 3000,
          }),
          createTestEvent({
            session_id: 's-goals',
            page_number: 2,
            name: 'goal',
            path: '/checkout',
            page_duration: 0,
            goal_name: 'purchase',
          }),
        ],
        format: 'JSONEachRow',
      });

      const result = await client.query({
        query: `SELECT path, page_number FROM ${workspaceDb}.pages FINAL WHERE session_id = 's-goals' ORDER BY page_number`,
      });
      const { data: rows } = (await result.json()) as {
        data: Array<{ path: string; page_number: number }>;
      };

      // Only screen_view events create pages rows
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.path)).toEqual(['/home', '/checkout']);
    });
  });
});
