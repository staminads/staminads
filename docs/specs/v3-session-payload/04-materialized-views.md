# Phase 4: Materialized Views

**Status**: Ready for Implementation
**Estimated Effort**: 0.5 day
**Dependencies**: Phase 1 (database schema), Phase 3 (server handler)

## Overview

Update materialized views to leverage new columns and support cumulative payloads with deduplication. The main change is converting the pages table from `MergeTree` to `ReplacingMergeTree` to handle duplicate page rows from cumulative payloads.

**Note**: Sessions MV goal aggregations were already specified in Phase 1. This phase focuses on pages table/MV changes.

**Phased Implementation**:
- Phase 1: Adds `page_number` pass-through to pages_mv (keeps V2 path logic temporarily)
- Phase 4: Updates pages_mv to V3 path logic (`e.path` instead of `previous_path`)
- The V3 SDK (Phase 5) should not be deployed until Phase 4 is complete

## Design Decisions

### V2 vs V3 Pages MV Logic (CRITICAL)

In V2, the event on navigation carried the duration of the PREVIOUS page:
```
User views /home for 10s → navigates to /about
V2 Event: { path: '/about', previous_path: '/home', page_duration: 10000 }
                                                    ↑ duration is for previous_path!
```

In V3, each PageviewAction represents a COMPLETED page:
```
SDK builds actions: [{ path: '/home', duration: 10000 }, { path: '/about', duration: 5000 }]
                           ↑ duration is for THIS path
```

**Consequence**: Pages MV must use `e.path` (not `e.previous_path`) for V3.

| Aspect | V2 (old) | V3 (new) |
|--------|----------|----------|
| Path in pages | `e.previous_path` | `e.path` |
| Duration owner | previous_path | path |
| First page | Excluded (`previous_path=''`) | Included |
| Ping events | Needed for last page | Not needed |

### Problem: Pages Table Duplication

With cumulative payloads, the same pageview event may be inserted multiple times (with updated duration/scroll). Current pages table:
- Uses `MergeTree()` engine (no deduplication)
- Uses `generateUUIDv4()` for ID (random each time)
- Creates duplicate rows for each event insert

### Solution: ReplacingMergeTree with Deterministic ID

| Aspect | Before | After |
|--------|--------|-------|
| Engine | `MergeTree()` | `ReplacingMergeTree(_version)` |
| ID | `generateUUIDv4()` | `{session_id}_{page_number}` (deterministic) |
| Conflict resolution | None (duplicates) | `_version` (higher wins) |
| Query pattern | Direct query | Use `FINAL` or aggregate |

### ID Format

Since `id` column is `UUID` type, we need a new `page_id String` column for the deterministic key:
- Format: `{session_id}_{page_number}`
- Example: `sess123_5` (5th page of session sess123)

The `id` column remains UUID for backwards compatibility but is no longer meaningful.

### ORDER BY Change

| Table | Before | After |
|-------|--------|-------|
| pages | `ORDER BY (session_id, entered_at)` | `ORDER BY (session_id, page_number)` |

Changing ORDER BY to `page_number` optimizes for:
- Deduplication by `(session_id, page_number)` composite key
- Page sequence queries

**Note**: Changing ORDER BY requires table recreation (not just ALTER).

## Schema Changes

### Pages Table

| Column | Change | Purpose |
|--------|--------|---------|
| `page_id` | Add `String DEFAULT ''` | Deterministic key for dedup |
| `_version` | Add `UInt64 DEFAULT 0` | Conflict resolution |
| Engine | `MergeTree()` → `ReplacingMergeTree(_version)` | Enable dedup |
| ORDER BY | `(session_id, entered_at)` → `(session_id, page_number)` | Optimize dedup |

### Pages MV

| Field | Before | After |
|-------|--------|-------|
| `page_id` | N/A | `concat(e.session_id, '_', toString(e.page_number))` |
| `_version` | N/A | `e._version` |
| `id` | `generateUUIDv4()` | `generateUUIDv4()` (keep, unused) |

## Test Specifications (TDD)

### Test Setup

```typescript
import { ClickHouseClient, createClient } from '@clickhouse/client';
import { V3Migration } from './v3.migration';

describe('V3Migration - Pages MV', () => {
  let client: ClickHouseClient;
  let migration: V3Migration;
  const workspaceDb = 'test_ws_pages_mv';

  // Helper to create test event with all required fields
  // In V3: path is the completed page, page_duration is for that path
  const createTestEvent = (overrides: Record<string, any> = {}) => ({
    session_id: 'test-session',
    workspace_id: 'test-ws',
    name: 'screen_view',
    path: '/test',                        // The page that was viewed (with its duration)
    previous_path: '',                    // Previous page (for chaining, not for duration)
    page_number: 1,
    page_duration: 5000,                  // Duration in ms for THIS path
    max_scroll: 50,
    _version: Date.now(),
    landing_page: 'https://example.com/',
    landing_path: '/',
    goal_name: '',                        // For goal events
    goal_value: 0,                        // For goal events
    received_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    });

    // Create test database and apply full migration
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${workspaceDb}` });
    migration = new V3Migration();
  });

  afterAll(async () => {
    await client.command({ query: `DROP DATABASE IF EXISTS ${workspaceDb}` });
    await client.close();
  });

  beforeEach(async () => {
    // Recreate tables fresh each test
    await client.command({ query: `DROP TABLE IF EXISTS ${workspaceDb}.pages_mv` });
    await client.command({ query: `DROP TABLE IF EXISTS ${workspaceDb}.pages` });
    await client.command({ query: `DROP TABLE IF EXISTS ${workspaceDb}.sessions_mv` });
    await client.command({ query: `DROP TABLE IF EXISTS ${workspaceDb}.sessions` });
    await client.command({ query: `DROP TABLE IF EXISTS ${workspaceDb}.events` });
    // Note: migration.migrateWorkspace() will create all tables with correct schema
  });
```

### Test 1: Pages table has ReplacingMergeTree engine

```typescript
describe('pages table engine', () => {
  it('uses ReplacingMergeTree with _version', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const result = await client.query({
      query: `
        SELECT engine, engine_full
        FROM system.tables
        WHERE database = '${workspaceDb}' AND name = 'pages'
      `,
    });
    const { data: rows } = await result.json();

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
    const { data: rows } = await result.json();

    expect(rows[0].sorting_key).toBe('session_id, page_number');
  });
});
```

### Test 2: Pages table has new columns

```typescript
describe('pages table columns', () => {
  it('has page_id String column', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const result = await client.query({
      query: `
        SELECT name, type, default_expression
        FROM system.columns
        WHERE database = '${workspaceDb}' AND table = 'pages' AND name = 'page_id'
      `,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('String');
  });

  it('has _version UInt64 column', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const result = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = '${workspaceDb}' AND table = 'pages' AND name = '_version'
      `,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('UInt64');
  });

  it('has page_number as UInt16', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const result = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = '${workspaceDb}' AND table = 'pages' AND name = 'page_number'
      `,
    });
    const { data: rows } = await result.json();

    expect(rows[0].type).toBe('UInt16');
  });
});
```

### Test 3: Pages MV generates deterministic page_id

```typescript
describe('pages_mv page_id', () => {
  it('generates page_id from session_id and page_number', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert event that triggers pages_mv
    // In V3: path is the completed page, page_duration is for that path
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({
          session_id: 'sess-abc',
          page_number: 5,
          path: '/checkout',  // This is the page that was viewed
          page_duration: 8000,
        }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT page_id, path FROM ${workspaceDb}.pages WHERE session_id = 'sess-abc'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].page_id).toBe('sess-abc_5');
    expect(rows[0].path).toBe('/checkout');  // V3: path is the completed page
  });

  it('same session_id + page_number produces same page_id', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert same page twice (simulating cumulative payload)
    const event1 = createTestEvent({
      session_id: 'sess-xyz',
      page_number: 3,
      page_duration: 5000,
      max_scroll: 30,
      _version: 1000,
    });
    const event2 = createTestEvent({
      session_id: 'sess-xyz',
      page_number: 3,
      page_duration: 10000,  // Updated duration
      max_scroll: 75,        // Updated scroll
      _version: 2000,        // Higher version
    });

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [event1, event2],
      format: 'JSONEachRow',
    });

    // Check both inserts created same page_id
    const result = await client.query({
      query: `SELECT page_id, count() as cnt FROM ${workspaceDb}.pages WHERE session_id = 'sess-xyz' GROUP BY page_id`,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(1);
    expect(rows[0].page_id).toBe('sess-xyz_3');
    expect(rows[0].cnt).toBe('2');  // Two rows, same page_id
  });
});
```

### Test 4: ReplacingMergeTree deduplication with FINAL

```typescript
describe('pages deduplication', () => {
  it('FINAL returns latest version for same page_id', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert same page twice with different versions
    const event1 = createTestEvent({
      session_id: 'sess-dedup',
      page_number: 2,
      page_duration: 5000,
      max_scroll: 30,
      _version: 1704067200000,  // Earlier version
    });
    const event2 = createTestEvent({
      session_id: 'sess-dedup',
      page_number: 2,
      page_duration: 15000,  // Updated: longer duration
      max_scroll: 85,         // Updated: more scroll
      _version: 1704067260000,  // Later version (60 seconds later)
    });

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [event1],
      format: 'JSONEachRow',
    });
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [event2],
      format: 'JSONEachRow',
    });

    // Query with FINAL to get deduplicated result
    const result = await client.query({
      query: `
        SELECT page_id, duration, max_scroll, _version
        FROM ${workspaceDb}.pages FINAL
        WHERE session_id = 'sess-dedup'
      `,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(1);
    expect(rows[0].page_id).toBe('sess-dedup_2');
    expect(rows[0].duration).toBe(15000);  // Latest value
    expect(rows[0].max_scroll).toBe(85);    // Latest value
    expect(Number(rows[0]._version)).toBe(1704067260000);
  });

  it('different page_numbers create separate rows', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // In V3: each event represents a completed page
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's1', page_number: 1, path: '/home', page_duration: 5000 }),
        createTestEvent({ session_id: 's1', page_number: 2, path: '/about', page_duration: 3000 }),
        createTestEvent({ session_id: 's1', page_number: 3, path: '/contact', page_duration: 2000 }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT page_id, path FROM ${workspaceDb}.pages FINAL WHERE session_id = 's1' ORDER BY page_number`,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(3);
    expect(rows.map((r: any) => r.page_id)).toEqual(['s1_1', 's1_2', 's1_3']);
    expect(rows.map((r: any) => r.path)).toEqual(['/home', '/about', '/contact']);
  });

  it('first page (page_number=1) is included in V3', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // In V2, first page was excluded (previous_path='')
    // In V3, first page should be included
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({
          session_id: 's-first',
          page_number: 1,
          path: '/landing',
          previous_path: '',  // First page has no previous
          page_duration: 10000,
        }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT page_id, path FROM ${workspaceDb}.pages WHERE session_id = 's-first'`,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/landing');  // First page included!
  });
});
```

### Test 5: Pages MV passes through _version

```typescript
describe('pages_mv _version', () => {
  it('passes _version from events to pages', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    const version = 1704067200000;
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [createTestEvent({ _version: version })],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT _version FROM ${workspaceDb}.pages`,
    });
    const { data: rows } = await result.json();

    expect(Number(rows[0]._version)).toBe(version);
  });
});
```

### Test 6: Pages MV uses page_number from events and detects landing

```typescript
describe('pages_mv page_number and is_landing', () => {
  it('uses page_number from events (not hardcoded)', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's1', page_number: 7, path: '/page-7', page_duration: 5000 }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT page_number, path FROM ${workspaceDb}.pages WHERE session_id = 's1'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].page_number).toBe(7);
    expect(rows[0].path).toBe('/page-7');
  });

  it('detects landing page correctly', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        // Landing page: path matches landing_path
        createTestEvent({
          session_id: 's-landing',
          page_number: 1,
          path: '/products',
          landing_path: '/products',
          page_duration: 5000,
        }),
        // Non-landing page
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
    const { data: rows } = await result.json();

    expect(rows[0].is_landing).toBe(1);  // /products is landing
    expect(rows[1].is_landing).toBe(0);  // /checkout is not landing
  });

  it('excludes events with page_duration=0', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's-zero', page_number: 1, path: '/a', page_duration: 5000 }),
        createTestEvent({ session_id: 's-zero', page_number: 2, path: '/b', page_duration: 0 }),  // Should be excluded
        createTestEvent({ session_id: 's-zero', page_number: 3, path: '/c', page_duration: 3000 }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT path FROM ${workspaceDb}.pages WHERE session_id = 's-zero' ORDER BY page_number`,
    });
    const { data: rows } = await result.json();

    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.path)).toEqual(['/a', '/c']);  // /b excluded
  });

  it('goal events do not create pages rows', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert mix of screen_view and goal events
    // Goals have page_duration=0 (set by server handler), so they should be excluded
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's-goals', page_number: 1, name: 'screen_view', path: '/home', page_duration: 5000 }),
        createTestEvent({ session_id: 's-goals', page_number: 1, name: 'goal', path: '/home', page_duration: 0, goal_name: 'signup' }),
        createTestEvent({ session_id: 's-goals', page_number: 2, name: 'screen_view', path: '/checkout', page_duration: 3000 }),
        createTestEvent({ session_id: 's-goals', page_number: 2, name: 'goal', path: '/checkout', page_duration: 0, goal_name: 'purchase' }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT path, page_number FROM ${workspaceDb}.pages FINAL WHERE session_id = 's-goals' ORDER BY page_number`,
    });
    const { data: rows } = await result.json();

    // Only screen_view events create pages rows
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.path)).toEqual(['/home', '/checkout']);
  });
});
```

### Test 7: Sessions MV goal aggregations (verify Phase 1)

```typescript
describe('sessions_mv goal aggregations', () => {
  it('counts goals correctly', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's1', name: 'screen_view' }),
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'signup' }),
        createTestEvent({ session_id: 's1', name: 'goal', goal_name: 'purchase' }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 's1'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].goal_count).toBe(2);
  });

  it('sums goal_value correctly', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's2', name: 'goal', goal_value: 99.99 }),
        createTestEvent({ session_id: 's2', name: 'goal', goal_value: 49.50 }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT goal_value FROM ${workspaceDb}.sessions FINAL WHERE id = 's2'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].goal_value).toBeCloseTo(149.49, 2);
  });

  it('does not count goals in pageview_count', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    await client.insert({
      table: `${workspaceDb}.events`,
      values: [
        createTestEvent({ session_id: 's3', name: 'screen_view' }),
        createTestEvent({ session_id: 's3', name: 'screen_view' }),
        createTestEvent({ session_id: 's3', name: 'goal', goal_name: 'signup' }),
      ],
      format: 'JSONEachRow',
    });

    const result = await client.query({
      query: `SELECT pageview_count, goal_count FROM ${workspaceDb}.sessions FINAL WHERE id = 's3'`,
    });
    const { data: rows } = await result.json();

    expect(rows[0].pageview_count).toBe(2);
    expect(rows[0].goal_count).toBe(1);
  });
});
```

### Test 8: Migration is idempotent

```typescript
describe('migration idempotency', () => {
  it('can run migration multiple times without error', async () => {
    await migration.migrateWorkspace(client, workspaceDb);
    await expect(migration.migrateWorkspace(client, workspaceDb)).resolves.not.toThrow();
  });

  it('preserves pages data after re-migration', async () => {
    await migration.migrateWorkspace(client, workspaceDb);

    // Insert event
    await client.insert({
      table: `${workspaceDb}.events`,
      values: [createTestEvent({ session_id: 'preserve-test' })],
      format: 'JSONEachRow',
    });

    // Run migration again
    await migration.migrateWorkspace(client, workspaceDb);

    // Data should still exist
    const result = await client.query({
      query: `SELECT count() as cnt FROM ${workspaceDb}.pages WHERE session_id = 'preserve-test'`,
    });
    const { data: rows } = await result.json();

    expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(1);
  });
});
// Close main describe
});
```

## Schema Definitions

### Pages Table (Updated)

```sql
CREATE TABLE IF NOT EXISTS {database}.pages (
  -- Identity
  id UUID DEFAULT generateUUIDv4(),
  page_id String DEFAULT '',              -- NEW: Deterministic key
  session_id String,
  workspace_id String,

  -- Page info
  path String,
  full_url String DEFAULT '',

  -- Timestamps
  entered_at DateTime64(3),
  exited_at DateTime64(3),

  -- Engagement
  duration UInt32 DEFAULT 0,
  max_scroll UInt8 DEFAULT 0,

  -- Sequence
  page_number UInt16 DEFAULT 1,           -- CHANGED: UInt8 -> UInt16
  is_landing Bool DEFAULT false,
  is_exit Bool DEFAULT false,

  -- Entry type
  entry_type LowCardinality(String) DEFAULT 'navigation',

  -- Technical
  received_at DateTime64(3) DEFAULT now64(3),
  _version UInt64 DEFAULT 0               -- NEW: Conflict resolution
) ENGINE = ReplacingMergeTree(_version)   -- CHANGED: MergeTree -> ReplacingMergeTree
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (session_id, page_number)        -- CHANGED: was (session_id, entered_at)
TTL toDateTime(received_at) + INTERVAL 7 DAY
```

### Pages MV (Updated)

**CRITICAL CHANGE for V3**: In V2, the event on navigation carried the duration of the PREVIOUS page (so `previous_path` was the page with the duration). In V3, each PageviewAction represents a COMPLETED page where `path` has the duration. So we use `e.path` directly instead of the V2 `previous_path` logic.

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS {database}.pages_mv
TO {database}.pages AS
SELECT
  generateUUIDv4() as id,
  concat(e.session_id, '_', toString(e.page_number)) as page_id,  -- NEW: deterministic
  e.session_id,
  e.workspace_id,
  e.path,                                 -- CHANGED: was complex previous_path logic (V2)
  e.landing_page as full_url,
  subtractSeconds(e.updated_at, intDiv(e.page_duration, 1000)) as entered_at,  -- Convert ms to seconds (integer division)
  e.updated_at as exited_at,
  e.page_duration as duration,
  e.max_scroll,
  e.page_number,                          -- CHANGED: was hardcoded 1
  e.path = e.landing_path as is_landing,  -- SIMPLIFIED: just compare path
  0 as is_exit,                           -- No longer relevant in V3 (SDK sends completed pages)
  if(e.path = e.landing_path, 'landing', 'navigation') as entry_type,
  now64(3) as received_at,
  e._version                              -- NEW: pass through from events
FROM {database}.events e
WHERE e.name = 'screen_view' AND e.page_duration > 0  -- SIMPLIFIED: no previous_path check, no ping
```

**Why these changes:**
- `e.path`: In V3, the path IS the completed page (not previous_path like in V2)
- `WHERE` simplified: First page now included (V2 excluded it via `previous_path != ''`)
- `is_exit` removed: V3 SDK sends completed PageviewActions, no separate "ping" event
- `entered_at` fix: `page_duration` is in milliseconds, convert to seconds for subtraction

### Sessions MV (for reference, from Phase 1)

Goal aggregations already specified:
```sql
-- After max_scroll aggregation:
countIf(e.name = 'goal') as goal_count,
sumIf(e.goal_value, e.name = 'goal') as goal_value,
```

## Migration Implementation

### File: `api/src/migrations/versions/v3.migration.ts` (extend)

Add these steps to handle pages table recreation:

```typescript
// === Phase 4: Pages table changes ===

// Since we're changing ENGINE and ORDER BY, we need to recreate the table.
// Strategy: Create new table, copy data, swap, drop old.

// Step 1: Drop pages_mv first (depends on pages)
await client.command({
  query: `DROP VIEW IF EXISTS ${workspaceDb}.pages_mv`,
});

// Step 2: Check if pages_new already exists (idempotency)
const pagesNewExists = await client.query({
  query: `
    SELECT count() as cnt
    FROM system.tables
    WHERE database = '${workspaceDb}' AND name = 'pages_new'
  `,
});
const pagesNewResult = await pagesNewExists.json();

if (Number(pagesNewResult.data[0].cnt) === 0) {
  // Step 3: Create new pages table with correct schema
  await client.command({
    query: `
      CREATE TABLE ${workspaceDb}.pages_new (
        id UUID DEFAULT generateUUIDv4(),
        page_id String DEFAULT '',
        session_id String,
        workspace_id String,
        path String,
        full_url String DEFAULT '',
        entered_at DateTime64(3),
        exited_at DateTime64(3),
        duration UInt32 DEFAULT 0,
        max_scroll UInt8 DEFAULT 0,
        page_number UInt16 DEFAULT 1,
        is_landing Bool DEFAULT false,
        is_exit Bool DEFAULT false,
        entry_type LowCardinality(String) DEFAULT 'navigation',
        received_at DateTime64(3) DEFAULT now64(3),
        _version UInt64 DEFAULT 0
      ) ENGINE = ReplacingMergeTree(_version)
      PARTITION BY toYYYYMMDD(received_at)
      ORDER BY (session_id, page_number)
      TTL toDateTime(received_at) + INTERVAL 7 DAY
    `,
  });

  // Step 4: Copy existing data (if any) with generated page_id
  await client.command({
    query: `
      INSERT INTO ${workspaceDb}.pages_new
      SELECT
        id,
        concat(session_id, '_', toString(page_number)) as page_id,
        session_id,
        workspace_id,
        path,
        full_url,
        entered_at,
        exited_at,
        duration,
        max_scroll,
        page_number,
        is_landing,
        is_exit,
        entry_type,
        received_at,
        0 as _version
      FROM ${workspaceDb}.pages
    `,
  });
}

// Step 5: Swap tables (with idempotency checks)
// Check if pages_new exists (needs to be swapped)
const pagesNewExistsForSwap = await client.query({
  query: `
    SELECT count() as cnt
    FROM system.tables
    WHERE database = '${workspaceDb}' AND name = 'pages_new'
  `,
});
const swapResult = await pagesNewExistsForSwap.json();

if (Number(swapResult.data[0].cnt) > 0) {
  // pages_new exists, need to swap
  await client.command({
    query: `DROP TABLE IF EXISTS ${workspaceDb}.pages`,
  });
  await client.command({
    query: `RENAME TABLE ${workspaceDb}.pages_new TO ${workspaceDb}.pages`,
  });
}

// Step 6: Recreate pages_mv with new schema (done in the existing MV recreation section)
// The updated pages_mv schema is in WORKSPACE_SCHEMAS.pages_mv
```

**Important**: The existing V3 migration already has a section that drops and recreates MVs. Update that section to use the new `pages_mv` schema from `WORKSPACE_SCHEMAS`.

### File: `api/src/database/schemas.ts` (updates)

#### Pages Table

Replace the entire `pages` schema with the new definition (see Schema Definitions above).

#### Pages MV

Replace the entire `pages_mv` schema with the new definition (see Schema Definitions above).

## Query Patterns

### Querying Pages with Deduplication

```sql
-- Use FINAL for deduplication
SELECT * FROM pages FINAL WHERE session_id = 'xxx';

-- Or use aggregate with argMax (more efficient for large queries)
SELECT
  page_id,
  argMax(path, _version) as path,
  argMax(duration, _version) as duration,
  argMax(max_scroll, _version) as max_scroll,
  max(_version) as _version
FROM pages
WHERE session_id = 'xxx'
GROUP BY page_id;
```

### Checking for Duplicate Pages (debugging)

```sql
-- Find pages with multiple versions
SELECT page_id, count() as versions
FROM pages
WHERE session_id = 'xxx'
GROUP BY page_id
HAVING count() > 1;
```

## Verification Queries

After migration, verify with these queries:

```sql
-- Check pages table engine
SELECT engine, engine_full, sorting_key
FROM system.tables
WHERE database = 'staminads_ws_<workspace_id>' AND name = 'pages';
-- Expected: engine='ReplacingMergeTree', sorting_key='session_id, page_number'

-- Check pages table columns
SELECT name, type
FROM system.columns
WHERE database = 'staminads_ws_<workspace_id>'
  AND table = 'pages'
  AND name IN ('page_id', '_version', 'page_number');
-- Expected: page_id String, _version UInt64, page_number UInt16

-- Check pages_mv definition
SHOW CREATE VIEW staminads_ws_<workspace_id>.pages_mv;
-- Should include: concat(e.session_id, '_', toString(e.page_number)) as page_id, e._version

-- Test deduplication (V3: path is the completed page, page_duration is for that path)
INSERT INTO staminads_ws_<workspace_id>.events
  (session_id, workspace_id, name, path, page_number, page_duration, max_scroll, _version, landing_page, landing_path, received_at, created_at, updated_at)
VALUES
  ('test-dedup', 'ws', 'screen_view', '/checkout', 2, 5000, 30, 1000, 'https://x.com/', '/', now(), now(), now()),
  ('test-dedup', 'ws', 'screen_view', '/checkout', 2, 10000, 80, 2000, 'https://x.com/', '/', now(), now(), now());

SELECT page_id, path, duration, max_scroll, _version
FROM staminads_ws_<workspace_id>.pages FINAL
WHERE session_id = 'test-dedup';
-- Expected: 1 row with page_id='test-dedup_2', path='/checkout', duration=10000, max_scroll=80, _version=2000
```

## Rollback Plan

If migration fails:

```sql
-- If pages_new exists but swap failed
DROP TABLE IF EXISTS {workspaceDb}.pages_new;

-- If pages was dropped, need to recreate from backup or events
-- (Full rollback would require restoring from backup)

-- Recreate pages_mv with old schema
DROP VIEW IF EXISTS {workspaceDb}.pages_mv;
CREATE MATERIALIZED VIEW {workspaceDb}.pages_mv
TO {workspaceDb}.pages AS
-- ... old schema definition ...
```

## Checklist

- [ ] Update `api/src/database/schemas.ts`:
  - [ ] Update pages table with new columns (page_id, _version), ReplacingMergeTree engine, ORDER BY
  - [ ] Update pages_mv with V3 logic:
    - [ ] Use `e.path` directly (NOT previous_path logic)
    - [ ] Generate `page_id` from `concat(session_id, '_', page_number)`
    - [ ] Pass through `_version` from events
    - [ ] Use `page_number` from events (NOT hardcoded 1)
    - [ ] Remove `previous_path != ''` condition from WHERE (first page should be included)
    - [ ] Remove ping event handling (not needed in V3)
- [ ] Update `api/src/migrations/versions/v3.migration.ts`:
  - [ ] Add pages table recreation logic (create new, copy data, swap)
- [ ] Create test file `api/src/migrations/versions/v3.migration.pages.spec.ts` (or extend existing)
- [ ] Run tests: `npm test -- v3.migration`
- [ ] Test migration on local ClickHouse:
  - [ ] Fresh install works
  - [ ] Migration from existing data works
  - [ ] Idempotent (can run twice)
- [ ] Verify:
  - [ ] pages table has ReplacingMergeTree(_version) engine
  - [ ] pages table ORDER BY is (session_id, page_number)
  - [ ] pages_mv uses `e.path` for path column (V3 logic)
  - [ ] pages_mv generates deterministic page_id
  - [ ] pages_mv passes through _version
  - [ ] pages_mv includes first page (page_number=1)
  - [ ] FINAL returns deduplicated pages
  - [ ] sessions_mv goal aggregations work (verify Phase 1)
