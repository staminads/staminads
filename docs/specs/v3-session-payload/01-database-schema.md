# Phase 1: Database Schema

**Status**: Ready for Implementation
**Estimated Effort**: 0.5 day

## Overview

Add new columns to support the session payload architecture with `actions[]` array containing pageviews and goals.

**Note**: These changes extend the existing V3 migration (`v3.migration.ts`). Version remains `3.0.0`.

## Design Decisions

### Column Defaults

| Table | Column | Default | Rationale |
|-------|--------|---------|-----------|
| `events` | `page_number` | `0` | 0 = default for DB, SDK always sends >= 1 |
| `pages` | `page_number` | `1` | Default for DB, SDK always sends >= 1 |

**Note**: No legacy data support. New SDK is required to send `page_number >= 1` for all events.

### `_version` Column

- Type: `UInt64` - epoch milliseconds set by server on insert
- Purpose: Conflict resolution for cumulative payloads with deduplication
- Used by: `argMax(_version)` in MVs to pick latest value for updatable fields

### ORDER BY (No Change)

Current: `ORDER BY (session_id, received_at)` - **Keep unchanged**. Adding `page_number` to ORDER BY would require table recreation and provides minimal query benefit since we filter by session_id first.

## Schema Changes

### Events Table

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `page_number` | `UInt16` | `0` | Page sequence within session (1-indexed) |
| `_version` | `UInt64` | `0` | Server timestamp for conflict resolution |
| `goal_name` | `String` | `''` | Goal identifier (for goal events) |
| `goal_value` | `Float32` | `0` | Goal value (e.g., purchase amount) |
| `dedup_token` | `String` | `''` | Deterministic token for deduplication |

### Sessions Table

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `goal_count` | `UInt16` | `0` | Number of goals completed in session |
| `goal_value` | `Float32` | `0` | Total goal value for session |

### Pages Table

| Column | Type Change | Purpose |
|--------|-------------|---------|
| `page_number` | `UInt8` → `UInt16` | Support sessions with >255 pages |

## Test Specifications (TDD)

### Test Setup

```typescript
import { ClickHouseClient, createClient } from '@clickhouse/client';
import { V3Migration } from './v3.migration';
import { WORKSPACE_SCHEMAS } from '../../database/schemas';

describe('V3Migration', () => {
  let client: ClickHouseClient;
  let migration: V3Migration;
  const workspaceDb = 'test_ws_migration';

  // Helper to create test event with all required fields
  const createTestEvent = (overrides: Record<string, any> = {}) => ({
    session_id: 'test-session',
    workspace_id: 'test-ws',
    name: 'screen_view',
    path: '/test',
    landing_page: 'https://example.com/',
    landing_path: '/',
    received_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    page_duration: 0,
    page_number: 1,
    goal_name: '',
    goal_value: 0,
    ...overrides,
  });

  beforeAll(async () => {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    });
    migration = new V3Migration();

    // Create test database
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${workspaceDb}` });

    // Create base tables (without new columns)
    await client.command({
      query: WORKSPACE_SCHEMAS.events.replace(/{database}/g, workspaceDb),
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.sessions.replace(/{database}/g, workspaceDb),
    });
    await client.command({
      query: WORKSPACE_SCHEMAS.pages.replace(/{database}/g, workspaceDb),
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
```

### Helper Function

```typescript
async function getTableColumns(
  client: ClickHouseClient,
  database: string,
  table: string,
): Promise<Array<{ name: string; type: string; default_expression: string }>> {
  const result = await client.query({
    query: `
      SELECT name, type, default_expression
      FROM system.columns
      WHERE database = '${database}' AND table = '${table}'
    `,
  });
  return (await result.json()).data;
}
```

### Test 1: Events table has new columns after migration

```typescript
describe('V3Migration - Events Table', () => {
  it('adds page_number column with correct type and default', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'events');

    expect(columns).toContainEqual({
      name: 'page_number',
      type: 'UInt16',
      default_expression: '0',
    });
  });

  it('adds _version column with correct type and default', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'events');

    expect(columns).toContainEqual({
      name: '_version',
      type: 'UInt64',
      default_expression: '0',
    });
  });

  it('adds goal_name column with correct type and default', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'events');

    expect(columns).toContainEqual({
      name: 'goal_name',
      type: 'String',
      default_expression: "''",
    });
  });

  it('adds goal_value column with correct type and default', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'events');

    expect(columns).toContainEqual({
      name: 'goal_value',
      type: 'Float32',
      default_expression: '0',
    });
  });
});
```

### Test 2: Sessions table has new columns after migration

```typescript
describe('V3Migration - Sessions Table', () => {
  it('adds goal_count column with correct type and default', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'sessions');

    expect(columns).toContainEqual({
      name: 'goal_count',
      type: 'UInt16',
      default_expression: '0',
    });
  });

  it('adds goal_value column with correct type and default', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'sessions');

    expect(columns).toContainEqual({
      name: 'goal_value',
      type: 'Float32',
      default_expression: '0',
    });
  });
});
```

### Test 3: Pages table page_number is UInt16

```typescript
describe('V3Migration - Pages Table', () => {
  it('has page_number as UInt16 (not UInt8)', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const columns = await getTableColumns(client, workspaceDb, 'pages');
    const pageNumberCol = columns.find(c => c.name === 'page_number');

    expect(pageNumberCol?.type).toBe('UInt16');
  });
});
```

### Test 4: Migration is idempotent

```typescript
describe('V3Migration - Idempotency', () => {
  it('can run multiple times without error', async () => {
    // Run migration twice
    await migration.migrateWorkspace(client, workspaceDb);
    await expect(
      migration.migrateWorkspace(client, workspaceDb)
    ).resolves.not.toThrow();
  });

  it('preserves existing data after re-run', async () => {
    // Insert test event with all required fields
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [createTestEvent({ session_id: 'test-session', path: '/test' })],
      format: 'JSONEachRow',
    });

    // Run migration
    await migration.migrateWorkspace(client, workspaceDb);

    // Verify data still exists
    const result = await client.query({
      query: `SELECT * FROM ${workspaceDb}.events WHERE session_id = 'test-session'`,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/test');
  });
});
```

### Test 5: Sessions MV includes goal aggregations

```typescript
describe('V3Migration - Sessions MV', () => {
  it('aggregates goal_count from events', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert goal events with all required fields
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'signup' }),
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'purchase' }),
        createTestEvent({ session_id: 's1', name: 'screen_view', path: '/home' }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].goal_count).toBe(2);
  });

  it('sums goal_value from events', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert goal events with values
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'purchase', goal_value: 99.99 }),
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'upsell', goal_value: 29.99 }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT goal_value FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].goal_value).toBeCloseTo(129.98, 2);
  });

  it('goal events do not inflate pageview_count', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert mix of screen_view and goal events
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's1', name: 'screen_view', path: '/home' }),
        createTestEvent({ session_id: 's1', name: 'screen_view', path: '/about' }),
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'signup' }),
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'purchase' }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT pageview_count, goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].pageview_count).toBe(2); // Only screen_view events
    expect(rows[0].goal_count).toBe(2);     // Only goal events
  });
});
```

### Test 6: Pages MV uses page_number from events

**Note**: This test only verifies `page_number` pass-through. The path logic is updated in Phase 4 to use V3 semantics (`e.path` instead of `previous_path`).

```typescript
describe('V3Migration - Pages MV', () => {
  it('uses page_number from events instead of hardcoded 1', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert event with explicit page_number
    // Note: After Phase 4, path will be the completed page (V3 semantics)
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({
          session_id: 's1',
          name: 'screen_view',
          path: '/checkout',
          page_number: 5,
          page_duration: 30000,  // 30 seconds in ms
          previous_path: '/cart',
          landing_path: '/home',
        }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT page_number FROM ${workspaceDb}.pages WHERE session_id = 's1'`,
    });
    const { data: rows } = await result.json();

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
    const { data: rows } = await result.json();

    expect(rows[0].page_number).toBe(300);  // Would fail if UInt8
  });
});
// Close the main describe block
});
```

## Migration Implementation

### File: `api/src/migrations/versions/v3.migration.ts` (extend existing)

Add these steps to the existing `migrateWorkspace()` method, **before** the MV drop/recreate steps:

```typescript
// === NEW: Session payload columns ===

// Add new columns to events table
await client.command({
  query: `ALTER TABLE ${workspaceDb}.events
          ADD COLUMN IF NOT EXISTS page_number UInt16 DEFAULT 0`,
});
await client.command({
  query: `ALTER TABLE ${workspaceDb}.events
          ADD COLUMN IF NOT EXISTS _version UInt64 DEFAULT 0`,
});
await client.command({
  query: `ALTER TABLE ${workspaceDb}.events
          ADD COLUMN IF NOT EXISTS goal_name String DEFAULT ''`,
});
await client.command({
  query: `ALTER TABLE ${workspaceDb}.events
          ADD COLUMN IF NOT EXISTS goal_value Float32 DEFAULT 0`,
});
await client.command({
  query: `ALTER TABLE ${workspaceDb}.events
          ADD COLUMN IF NOT EXISTS dedup_token String DEFAULT ''`,
});

// Add new columns to sessions table
await client.command({
  query: `ALTER TABLE ${workspaceDb}.sessions
          ADD COLUMN IF NOT EXISTS goal_count UInt16 DEFAULT 0`,
});
await client.command({
  query: `ALTER TABLE ${workspaceDb}.sessions
          ADD COLUMN IF NOT EXISTS goal_value Float32 DEFAULT 0`,
});

// Widen pages.page_number from UInt8 to UInt16 (supports >255 pages)
// Note: MODIFY COLUMN is idempotent for widening type changes
await client.command({
  query: `ALTER TABLE ${workspaceDb}.pages
          MODIFY COLUMN page_number UInt16 DEFAULT 1`,
});

// === END NEW ===

// Existing: Drop and recreate MVs (already in v3.migration.ts)
// The MVs will be updated in schemas.ts to include goal aggregations
```

**Important**: The existing V3 migration already drops/recreates `sessions_mv` and `pages_mv` at the end. Do NOT duplicate these steps - just ensure `schemas.ts` has the updated MV definitions.

## Schema Updates Required

### File: `api/src/database/schemas.ts`

#### Events Table (add columns)

```typescript
// Add after max_scroll line:
page_number UInt16 DEFAULT 0,
_version UInt64 DEFAULT 0,
goal_name String DEFAULT '',
goal_value Float32 DEFAULT 0,
dedup_token String DEFAULT '',
```

#### Sessions Table (add columns)

```typescript
// Add after max_scroll line:
goal_count UInt16 DEFAULT 0,
goal_value Float32 DEFAULT 0,
```

#### Sessions MV (add aggregations)

```typescript
// Add after max_scroll aggregation (before sdk_version):
countIf(e.name = 'goal') as goal_count,
sumIf(e.goal_value, e.name = 'goal') as goal_value,
```

**Full sessions_mv after changes** (showing relevant section):
```sql
-- ... existing aggregations ...
max(e.max_scroll) as max_scroll,
countIf(e.name = 'goal') as goal_count,                    -- NEW
sumIf(e.goal_value, e.name = 'goal') as goal_value,        -- NEW
any(e.sdk_version) as sdk_version
FROM {database}.events e
GROUP BY e.session_id, e.workspace_id
```

#### Pages Table (change type)

```typescript
// Change:
page_number UInt8 DEFAULT 1,
// To:
page_number UInt16 DEFAULT 1,
```

#### Pages MV (use page_number from events)

```typescript
// Change:
1 as page_number,
// To:
e.page_number,
```

**Note**: No legacy fallback. New SDK always sends `page_number >= 1`.

**IMPORTANT**: This Phase 1 pages_mv keeps V2 path logic (`previous_path`). Phase 4 will replace with V3 logic (`e.path` directly). Do NOT deploy V3 SDK until Phase 4 is complete.

**Full pages_mv after Phase 1** (showing relevant section - V2 path logic preserved):
```sql
SELECT
  generateUUIDv4() as id,
  e.session_id,
  e.workspace_id,
  if(e.name = 'screen_view' AND e.previous_path != '', e.previous_path, e.path) as path,
  e.landing_page as full_url,
  subtractSeconds(e.updated_at, e.page_duration) as entered_at,
  e.updated_at as exited_at,
  e.page_duration as duration,
  e.max_scroll,
  e.page_number,                                            -- CHANGED: was hardcoded 1
  -- ... rest unchanged ...
FROM {database}.events e
WHERE (e.name = 'screen_view' AND e.previous_path != '' AND e.page_duration > 0)
   OR (e.name = 'ping' AND e.page_duration > 0)
```

## Verification Queries

After migration, run these queries to verify:

```sql
-- Check events table columns
SELECT name, type, default_expression
FROM system.columns
WHERE database = 'staminads_ws_<workspace_id>'
  AND table = 'events'
  AND name IN ('page_number', '_version', 'goal_name', 'goal_value');

-- Check sessions table columns
SELECT name, type, default_expression
FROM system.columns
WHERE database = 'staminads_ws_<workspace_id>'
  AND table = 'sessions'
  AND name IN ('goal_count', 'goal_value');

-- Check pages table page_number type
SELECT name, type
FROM system.columns
WHERE database = 'staminads_ws_<workspace_id>'
  AND table = 'pages'
  AND name = 'page_number';

-- Verify sessions_mv definition includes goal aggregations
SHOW CREATE VIEW staminads_ws_<workspace_id>.sessions_mv;

-- Verify pages_mv definition uses page_number from events
SHOW CREATE VIEW staminads_ws_<workspace_id>.pages_mv;
```

## Rollback Plan

If migration fails, run:

```sql
-- Note: Column removal is destructive, only use if necessary
ALTER TABLE {workspaceDb}.events DROP COLUMN IF EXISTS page_number;
ALTER TABLE {workspaceDb}.events DROP COLUMN IF EXISTS _version;
ALTER TABLE {workspaceDb}.events DROP COLUMN IF EXISTS goal_name;
ALTER TABLE {workspaceDb}.events DROP COLUMN IF EXISTS goal_value;

ALTER TABLE {workspaceDb}.sessions DROP COLUMN IF EXISTS goal_count;
ALTER TABLE {workspaceDb}.sessions DROP COLUMN IF EXISTS goal_value;

-- Recreate MVs with v3 definitions
DROP VIEW IF EXISTS {workspaceDb}.sessions_mv;
DROP VIEW IF EXISTS {workspaceDb}.pages_mv;
-- Then recreate with original v3 schema definitions (before session payload changes)
```

## Checklist

- [ ] Update `api/src/database/schemas.ts` with new columns and MV changes
- [ ] Update `api/src/migrations/versions/v3.migration.ts` with new ALTER statements
- [ ] Create/update `api/src/migrations/versions/v3.migration.spec.ts` with integration tests
- [ ] Run tests: `npm test -- v3.migration`
- [ ] Test migration on local ClickHouse instance
- [ ] Verify all columns exist with correct types
- [ ] Verify sessions_mv aggregates goal_count and goal_value correctly
- [ ] Verify pages_mv uses page_number from events
- [ ] Verify goal events don't inflate pageview_count
- [ ] Verify migration is idempotent (can run twice without error)
