// Set env vars BEFORE any imports to ensure proper configuration
import { setupTestEnv, TEST_SYSTEM_DATABASE } from './constants/test-config';
setupTestEnv();

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from '../src/migrations/migration.interface';
import { waitForClickHouse, waitForMutations } from './helpers/wait.helper';
import { truncateSystemTables } from './helpers/cleanup.helper';
import { toClickHouseDateTime, createTestWorkspace } from './helpers';

// Mock version and registry modules before importing MigrationsRunner
let mockMajorVersion = 2;
let mockMigrations: MajorMigration[] = [];

jest.mock('../src/version', () => ({
  get APP_MAJOR_VERSION() {
    return mockMajorVersion;
  },
  APP_VERSION: '2.4.0',
}));

jest.mock('../src/migrations/migrations.registry', () => ({
  get MIGRATIONS() {
    return mockMigrations;
  },
}));

// Import after mocks are set up
import { MigrationsRunner } from '../src/migrations/migrations.service';

describe('Migrations E2E', () => {
  let systemClient: ClickHouseClient;

  beforeAll(async () => {
    systemClient = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      database: TEST_SYSTEM_DATABASE,
    });
  });

  afterAll(async () => {
    await systemClient.close();
  });

  beforeEach(async () => {
    // Clean system_settings before each test
    await truncateSystemTables(systemClient, ['system_settings']);
    await waitForClickHouse();

    // Reset mock values
    mockMajorVersion = 2;
    mockMigrations = [];
  });

  afterEach(async () => {
    // Clean up any locks left over
    try {
      await systemClient.command({
        query: `ALTER TABLE system_settings DELETE WHERE key = 'migration_lock'`,
      });
      await waitForMutations(systemClient, TEST_SYSTEM_DATABASE);
    } catch {
      // Ignore errors if table doesn't exist
    }

    // Restore setup_completed flag for other tests
    await systemClient.insert({
      table: 'system_settings',
      values: [
        {
          key: 'setup_completed',
          value: 'true',
          updated_at: toClickHouseDateTime(),
        },
      ],
      format: 'JSONEachRow',
    });
    await waitForClickHouse();
  });

  describe('Fresh Install Detection', () => {
    it('sets db_major_version to current version on fresh install', async () => {
      mockMajorVersion = 2;
      mockMigrations = [];

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      expect(needsRestart).toBe(false);

      await waitForClickHouse();

      // Verify version was set
      const result = await systemClient.query({
        query: `SELECT value FROM system_settings FINAL WHERE key = 'db_major_version'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ value: string }>();

      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('2');
    });
  });

  describe('Version Comparison', () => {
    it('returns false when already up to date', async () => {
      // Set current version in DB
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '2',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      mockMajorVersion = 2;
      mockMigrations = [];

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      expect(needsRestart).toBe(false);
    });

    it('throws error on downgrade attempt', async () => {
      // Set DB version higher than code version
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '5',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      mockMajorVersion = 3;
      mockMigrations = [];

      const runner = new MigrationsRunner();

      await expect(runner.run()).rejects.toThrow(
        'Database version (5) is newer than code version (3). Downgrade not supported.',
      );
    });
  });

  describe('System Migration Execution', () => {
    it('runs system migration and updates version', async () => {
      // Set DB at version 1
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '1',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      const migrateSystemMock = jest.fn().mockResolvedValue(undefined);
      const mockMigration: MajorMigration = {
        majorVersion: 2,
        hasSystemMigration: () => true,
        hasWorkspaceMigration: () => false,
        migrateSystem: migrateSystemMock,
        migrateWorkspace: jest.fn(),
      };

      mockMajorVersion = 2;
      mockMigrations = [mockMigration];

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      expect(needsRestart).toBe(true);
      expect(migrateSystemMock).toHaveBeenCalledTimes(1);
      expect(migrateSystemMock).toHaveBeenCalledWith(
        expect.anything(), // ClickHouse client
        TEST_SYSTEM_DATABASE,
      );

      await waitForClickHouse();

      // Verify version was updated
      const result = await systemClient.query({
        query: `SELECT value FROM system_settings FINAL WHERE key = 'db_major_version'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ value: string }>();

      expect(rows[0].value).toBe('2');
    });

    it('executes actual SQL migration commands', async () => {
      // Set DB at version 1
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '1',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      // Create a migration that adds a test setting
      const mockMigration: MajorMigration = {
        majorVersion: 2,
        hasSystemMigration: () => true,
        hasWorkspaceMigration: () => false,
        migrateSystem: async (client, systemDb) => {
          await client.insert({
            table: `${systemDb}.system_settings`,
            values: [
              {
                key: 'migration_test_key',
                value: 'migration_test_value',
                updated_at: new Date()
                  .toISOString()
                  .replace('T', ' ')
                  .slice(0, 23),
              },
            ],
            format: 'JSONEachRow',
          });
        },
        migrateWorkspace: jest.fn(),
      };

      mockMajorVersion = 2;
      mockMigrations = [mockMigration];

      const runner = new MigrationsRunner();
      await runner.run();

      await waitForClickHouse();

      // Verify migration created the test setting
      const result = await systemClient.query({
        query: `SELECT value FROM system_settings FINAL WHERE key = 'migration_test_key'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ value: string }>();

      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe('migration_test_value');
    });
  });

  describe('Workspace Migration Execution', () => {
    it('runs workspace migration for each workspace', async () => {
      // Create test workspaces
      await truncateSystemTables(systemClient, ['workspaces']);
      await createTestWorkspace(systemClient, 'ws_migration_1', {
        name: 'Migration Test 1',
      });
      await createTestWorkspace(systemClient, 'ws_migration_2', {
        name: 'Migration Test 2',
      });
      await waitForClickHouse();

      // Set DB at version 1
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '1',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      const migrateWorkspaceMock = jest.fn().mockResolvedValue(undefined);
      const mockMigration: MajorMigration = {
        majorVersion: 2,
        hasSystemMigration: () => false,
        hasWorkspaceMigration: () => true,
        migrateSystem: jest.fn(),
        migrateWorkspace: migrateWorkspaceMock,
      };

      mockMajorVersion = 2;
      mockMigrations = [mockMigration];

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      expect(needsRestart).toBe(true);
      expect(migrateWorkspaceMock).toHaveBeenCalledTimes(2);
      // Check workspace database names (sanitized)
      expect(migrateWorkspaceMock).toHaveBeenCalledWith(
        expect.anything(),
        'staminads_ws_ws_migration_1',
      );
      expect(migrateWorkspaceMock).toHaveBeenCalledWith(
        expect.anything(),
        'staminads_ws_ws_migration_2',
      );

      // Cleanup
      await truncateSystemTables(systemClient, ['workspaces']);
    });

    it('aborts on first workspace migration failure', async () => {
      // Create test workspaces
      await truncateSystemTables(systemClient, ['workspaces']);
      await createTestWorkspace(systemClient, 'ws_fail_1', {
        name: 'Fail Test 1',
      });
      await createTestWorkspace(systemClient, 'ws_fail_2', {
        name: 'Fail Test 2',
      });
      await waitForClickHouse();

      // Set DB at version 1
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '1',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      const migrateWorkspaceMock = jest
        .fn()
        .mockResolvedValueOnce(undefined) // First workspace succeeds
        .mockRejectedValueOnce(new Error('Workspace migration failed')); // Second fails

      const mockMigration: MajorMigration = {
        majorVersion: 2,
        hasSystemMigration: () => false,
        hasWorkspaceMigration: () => true,
        migrateSystem: jest.fn(),
        migrateWorkspace: migrateWorkspaceMock,
      };

      mockMajorVersion = 2;
      mockMigrations = [mockMigration];

      const runner = new MigrationsRunner();

      await expect(runner.run()).rejects.toThrow('Workspace migration failed');

      // Version should NOT have been updated (migration failed)
      const result = await systemClient.query({
        query: `SELECT value FROM system_settings FINAL WHERE key = 'db_major_version'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ value: string }>();
      expect(rows[0].value).toBe('1');

      // Cleanup
      await truncateSystemTables(systemClient, ['workspaces']);
    });
  });

  describe('Incremental Upgrades', () => {
    it('runs only one migration per execution', async () => {
      // Set DB at version 1, code at version 4
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '1',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      const v2Mock = jest.fn().mockResolvedValue(undefined);
      const v3Mock = jest.fn().mockResolvedValue(undefined);
      const v4Mock = jest.fn().mockResolvedValue(undefined);

      const migrations: MajorMigration[] = [
        {
          majorVersion: 2,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: v2Mock,
          migrateWorkspace: jest.fn(),
        },
        {
          majorVersion: 3,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: v3Mock,
          migrateWorkspace: jest.fn(),
        },
        {
          majorVersion: 4,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: v4Mock,
          migrateWorkspace: jest.fn(),
        },
      ];

      mockMajorVersion = 4;
      mockMigrations = migrations;

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      expect(needsRestart).toBe(true);
      // Only v2 should have run
      expect(v2Mock).toHaveBeenCalledTimes(1);
      expect(v3Mock).not.toHaveBeenCalled();
      expect(v4Mock).not.toHaveBeenCalled();

      await waitForClickHouse();

      // Version should be 2 (not 4)
      const result = await systemClient.query({
        query: `SELECT value FROM system_settings FINAL WHERE key = 'db_major_version'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ value: string }>();
      expect(rows[0].value).toBe('2');
    });
  });

  describe('Lock Behavior', () => {
    it('acquires and releases lock during migration', async () => {
      mockMajorVersion = 2;
      mockMigrations = [];

      const runner = new MigrationsRunner();
      await runner.run();

      await waitForClickHouse();
      await waitForMutations(systemClient, TEST_SYSTEM_DATABASE);

      // Lock should be released after migration
      const result = await systemClient.query({
        query: `SELECT value FROM system_settings FINAL WHERE key = 'migration_lock'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ value: string }>();

      expect(rows).toHaveLength(0);
    });

    it('exits when lock is held by another instance', async () => {
      // Insert an active lock
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'migration_lock',
            value: 'other-instance-123',
            updated_at: toClickHouseDateTime(), // Recent lock
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      mockMajorVersion = 2;
      mockMigrations = [];

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      // Should signal restart (another instance is handling migrations)
      expect(needsRestart).toBe(true);
    });

    it('takes over expired lock', async () => {
      // Insert an expired lock (10 minutes ago)
      const expiredTime = new Date(Date.now() - 10 * 60 * 1000);
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'migration_lock',
            value: 'expired-instance-123',
            updated_at: expiredTime
              .toISOString()
              .replace('T', ' ')
              .slice(0, 23),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      mockMajorVersion = 2;
      mockMigrations = [];

      const runner = new MigrationsRunner();
      const needsRestart = await runner.run();

      // Should proceed with fresh install logic
      expect(needsRestart).toBe(false);
    });
  });

  describe('Combined System and Workspace Migration', () => {
    it('runs system migration before workspace migrations', async () => {
      // Create test workspace
      await truncateSystemTables(systemClient, ['workspaces']);
      await createTestWorkspace(systemClient, 'ws_combined', {
        name: 'Combined Test',
      });
      await waitForClickHouse();

      // Set DB at version 1
      await systemClient.insert({
        table: 'system_settings',
        values: [
          {
            key: 'db_major_version',
            value: '1',
            updated_at: toClickHouseDateTime(),
          },
        ],
        format: 'JSONEachRow',
      });
      await waitForClickHouse();

      const callOrder: string[] = [];
      const mockMigration: MajorMigration = {
        majorVersion: 2,
        hasSystemMigration: () => true,
        hasWorkspaceMigration: () => true,
        migrateSystem: jest.fn().mockImplementation(async () => {
          callOrder.push('system');
        }),
        migrateWorkspace: jest.fn().mockImplementation(async () => {
          callOrder.push('workspace');
        }),
      };

      mockMajorVersion = 2;
      mockMigrations = [mockMigration];

      const runner = new MigrationsRunner();
      await runner.run();

      // System migration should run first
      expect(callOrder).toEqual(['system', 'workspace']);

      // Cleanup
      await truncateSystemTables(systemClient, ['workspaces']);
    });
  });
});
