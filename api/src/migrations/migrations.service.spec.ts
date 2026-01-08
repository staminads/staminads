import { ClickHouseClient } from '@clickhouse/client';
import { MajorMigration } from './migration.interface';

// Mock modules before importing MigrationsRunner
jest.mock('@clickhouse/client', () => ({
  createClient: jest.fn(),
}));

jest.mock('os', () => ({
  hostname: jest.fn().mockReturnValue('test-host'),
}));

// Mock version module
let mockMajorVersion = 2;
jest.mock('../version', () => ({
  get APP_MAJOR_VERSION() {
    return mockMajorVersion;
  },
}));

// Mock migrations registry
let mockMigrations: MajorMigration[] = [];
jest.mock('./migrations.registry', () => ({
  get MIGRATIONS() {
    return mockMigrations;
  },
}));

// Import after mocks are set up
import { MigrationsRunner } from './migrations.service';

describe('MigrationsRunner', () => {
  let runner: MigrationsRunner;
  let mockClient: jest.Mocked<ClickHouseClient>;
  let mockQuery: jest.Mock;
  let mockCommand: jest.Mock;
  let mockInsert: jest.Mock;
  let mockClose: jest.Mock;

  // Helper to create mock query result
  const createQueryResult = (rows: any[]) => ({
    json: jest.fn().mockResolvedValue(rows),
  });

  beforeEach(() => {
    // Reset environment
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
    process.env.CLICKHOUSE_USER = 'default';
    process.env.CLICKHOUSE_PASSWORD = '';
    process.env.CLICKHOUSE_SYSTEM_DATABASE = 'test_system';

    // Reset mocks
    mockMajorVersion = 2;
    mockMigrations = [];

    // Setup mock client methods
    mockQuery = jest.fn();
    mockCommand = jest.fn().mockResolvedValue(undefined);
    mockInsert = jest.fn().mockResolvedValue(undefined);
    mockClose = jest.fn().mockResolvedValue(undefined);

    mockClient = {
      query: mockQuery,
      command: mockCommand,
      insert: mockInsert,
      close: mockClose,
    } as unknown as jest.Mocked<ClickHouseClient>;

    // Mock createClient to return our mock
    const { createClient } = require('@clickhouse/client');
    (createClient as jest.Mock).mockReturnValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('run', () => {
    describe('fresh install', () => {
      it('sets db_major_version to current version and returns false', async () => {
        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - no version (fresh install)
        mockQuery.mockResolvedValueOnce(createQueryResult([]));

        runner = new MigrationsRunner();
        const needsRestart = await runner.run();

        expect(needsRestart).toBe(false);
        // Should have inserted version
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            table: 'test_system.system_settings',
            values: expect.arrayContaining([
              expect.objectContaining({
                key: 'db_major_version',
                value: '2',
              }),
            ]),
          }),
        );
      });
    });

    describe('already up to date', () => {
      it('returns false when db version equals code version', async () => {
        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - already at version 2
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '2' }]));

        runner = new MigrationsRunner();
        const needsRestart = await runner.run();

        expect(needsRestart).toBe(false);
        // Should not have updated version (only lock insert)
        expect(mockInsert).toHaveBeenCalledTimes(1);
      });
    });

    describe('needs upgrade', () => {
      it('runs migration and returns true when db version < code version', async () => {
        const mockMigration: MajorMigration = {
          majorVersion: 2,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };

        mockMigrations = [mockMigration];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - at version 1
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));

        runner = new MigrationsRunner();
        const needsRestart = await runner.run();

        expect(needsRestart).toBe(true);
        expect(mockMigration.migrateSystem).toHaveBeenCalled();
        // Should have updated version to 2
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            values: expect.arrayContaining([
              expect.objectContaining({
                key: 'db_major_version',
                value: '2',
              }),
            ]),
          }),
        );
      });

      it('runs workspace migrations for each workspace', async () => {
        const mockMigration: MajorMigration = {
          majorVersion: 2,
          hasSystemMigration: () => false,
          hasWorkspaceMigration: () => true,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };

        mockMigrations = [mockMigration];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - at version 1
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));
        // Get workspaces
        mockQuery.mockResolvedValueOnce(
          createQueryResult([{ id: 'ws-1' }, { id: 'ws-2' }, { id: 'ws-3' }]),
        );

        runner = new MigrationsRunner();
        await runner.run();

        expect(mockMigration.migrateWorkspace).toHaveBeenCalledTimes(3);
        expect(mockMigration.migrateWorkspace).toHaveBeenCalledWith(
          mockClient,
          'staminads_ws_ws_1',
        );
        expect(mockMigration.migrateWorkspace).toHaveBeenCalledWith(
          mockClient,
          'staminads_ws_ws_2',
        );
        expect(mockMigration.migrateWorkspace).toHaveBeenCalledWith(
          mockClient,
          'staminads_ws_ws_3',
        );
      });

      it('sanitizes workspace IDs for database names', async () => {
        const mockMigration: MajorMigration = {
          majorVersion: 2,
          hasSystemMigration: () => false,
          hasWorkspaceMigration: () => true,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };

        mockMigrations = [mockMigration];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - at version 1
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));
        // Get workspaces with special characters
        mockQuery.mockResolvedValueOnce(
          createQueryResult([{ id: 'ws-with-dashes' }]),
        );

        runner = new MigrationsRunner();
        await runner.run();

        // Dashes should be replaced with underscores
        expect(mockMigration.migrateWorkspace).toHaveBeenCalledWith(
          mockClient,
          'staminads_ws_ws_with_dashes',
        );
      });

      it('runs only the next migration (incremental upgrade)', async () => {
        mockMajorVersion = 4;

        const v2Migration: MajorMigration = {
          majorVersion: 2,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };
        const v3Migration: MajorMigration = {
          majorVersion: 3,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };
        const v4Migration: MajorMigration = {
          majorVersion: 4,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };

        mockMigrations = [v2Migration, v3Migration, v4Migration];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - at version 1, code is at 4
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));

        runner = new MigrationsRunner();
        await runner.run();

        // Should only run v2 migration (next one)
        expect(v2Migration.migrateSystem).toHaveBeenCalled();
        expect(v3Migration.migrateSystem).not.toHaveBeenCalled();
        expect(v4Migration.migrateSystem).not.toHaveBeenCalled();
        // Version should be updated to 2 (not 4)
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            values: expect.arrayContaining([
              expect.objectContaining({
                key: 'db_major_version',
                value: '2',
              }),
            ]),
          }),
        );
      });
    });

    describe('downgrade attempt', () => {
      it('throws error when db version > code version', async () => {
        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - db at version 3, code at 2
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '3' }]));

        runner = new MigrationsRunner();

        await expect(runner.run()).rejects.toThrow(
          'Database version (3) is newer than code version (2). Downgrade not supported.',
        );
      });
    });

    describe('missing migration', () => {
      it('throws error when required migration is not found', async () => {
        // No migrations registered
        mockMigrations = [];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - at version 1, code at 2
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));

        runner = new MigrationsRunner();

        await expect(runner.run()).rejects.toThrow(
          'Migration for version 2 not found',
        );
      });
    });

    describe('lock behavior', () => {
      it('returns true when lock is held by another instance', async () => {
        // Lock check - lock held by another instance (recent)
        const recentTime = new Date().toISOString();
        mockQuery.mockResolvedValueOnce(
          createQueryResult([
            { value: 'other-host-123', updated_at: recentTime },
          ]),
        );

        runner = new MigrationsRunner();
        const needsRestart = await runner.run();

        expect(needsRestart).toBe(true);
        // Should not have queried version or run any migrations
        expect(mockQuery).toHaveBeenCalledTimes(1);
      });

      it('acquires expired lock and proceeds with migration', async () => {
        // Lock check - lock exists but expired (6 minutes ago)
        const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        mockQuery.mockResolvedValueOnce(
          createQueryResult([
            { value: 'other-host-123', updated_at: expiredTime },
          ]),
        );
        // Version check - already up to date
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '2' }]));

        runner = new MigrationsRunner();
        const needsRestart = await runner.run();

        expect(needsRestart).toBe(false);
        // Should have acquired lock and checked version
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            values: expect.arrayContaining([
              expect.objectContaining({ key: 'migration_lock' }),
            ]),
          }),
        );
      });

      it('releases lock after successful migration', async () => {
        const mockMigration: MajorMigration = {
          majorVersion: 2,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: jest.fn().mockResolvedValue(undefined),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };

        mockMigrations = [mockMigration];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));

        runner = new MigrationsRunner();
        await runner.run();

        // Should have released lock
        expect(mockCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.stringContaining(
              "DELETE WHERE key = 'migration_lock'",
            ),
          }),
        );
      });

      it('releases lock even when migration fails', async () => {
        const mockMigration: MajorMigration = {
          majorVersion: 2,
          hasSystemMigration: () => true,
          hasWorkspaceMigration: () => false,
          migrateSystem: jest
            .fn()
            .mockRejectedValue(new Error('Migration failed')),
          migrateWorkspace: jest.fn().mockResolvedValue(undefined),
        };

        mockMigrations = [mockMigration];

        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));

        runner = new MigrationsRunner();

        await expect(runner.run()).rejects.toThrow('Migration failed');

        // Should still have released lock
        expect(mockCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.stringContaining(
              "DELETE WHERE key = 'migration_lock'",
            ),
          }),
        );
      });
    });

    describe('client lifecycle', () => {
      it('closes client after successful run', async () => {
        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - up to date
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '2' }]));

        runner = new MigrationsRunner();
        await runner.run();

        expect(mockClose).toHaveBeenCalled();
      });

      it('closes client even when run fails', async () => {
        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - needs upgrade
        mockQuery.mockResolvedValueOnce(createQueryResult([{ value: '1' }]));
        // No migration registered

        runner = new MigrationsRunner();

        await expect(runner.run()).rejects.toThrow();

        expect(mockClose).toHaveBeenCalled();
      });
    });

    describe('database initialization', () => {
      it('creates system database and settings table on startup', async () => {
        // Lock check - no lock
        mockQuery.mockResolvedValueOnce(createQueryResult([]));
        // Version check - fresh install
        mockQuery.mockResolvedValueOnce(createQueryResult([]));

        runner = new MigrationsRunner();
        await runner.run();

        // Should create database
        expect(mockCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'CREATE DATABASE IF NOT EXISTS test_system',
          }),
        );
        // Should create system_settings table
        expect(mockCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.stringContaining(
              'CREATE TABLE IF NOT EXISTS test_system.system_settings',
            ),
          }),
        );
      });
    });
  });
});
