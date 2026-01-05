import { Test, TestingModule } from '@nestjs/testing';
import { DemoService } from './demo.service';
import { ClickHouseService } from '../database/clickhouse.service';
import * as generators from './fixtures/generators';

// Mock generators module
jest.mock('./fixtures/generators', () => ({
  generateEventsByDay: jest.fn(),
  getCachedFilters: jest.fn(),
  clearFilterCache: jest.fn(),
}));

describe('DemoService', () => {
  let service: DemoService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            commandSystem: jest.fn(),
            insertSystem: jest.fn(),
            insertWorkspace: jest.fn(),
            createWorkspaceDatabase: jest.fn(),
            dropWorkspaceDatabase: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DemoService>(DemoService);
    clickhouse = module.get(ClickHouseService);

    // Reset mocks
    jest.clearAllMocks();

    // Default mock implementations
    (generators.getCachedFilters as jest.Mock).mockReturnValue({
      filters: [],
      version: 'v1',
    });
  });

  describe('generate', () => {
    it('clears filter cache before generation', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      // Empty generator
      (generators.generateEventsByDay as jest.Mock).mockReturnValue([]);

      await service.generate();

      expect(generators.clearFilterCache).toHaveBeenCalled();
    });

    it('deletes existing demo workspace before creating new one', async () => {
      // Existing workspace found
      clickhouse.querySystem.mockResolvedValue([{ id: 'demo-apple' }]);
      clickhouse.dropWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.commandSystem.mockResolvedValue(undefined);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      (generators.generateEventsByDay as jest.Mock).mockReturnValue([]);

      await service.generate();

      expect(clickhouse.dropWorkspaceDatabase).toHaveBeenCalledWith(
        'demo-apple',
      );
      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
      );
    });

    it('creates workspace database and inserts workspace row', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      (generators.generateEventsByDay as jest.Mock).mockReturnValue([]);

      await service.generate();

      expect(clickhouse.createWorkspaceDatabase).toHaveBeenCalledWith(
        'demo-apple',
      );
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'workspaces',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'demo-apple',
            name: 'Apple Demo',
          }),
        ]),
      );
    });

    it('creates workspace with settings JSON including annotations', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      (generators.generateEventsByDay as jest.Mock).mockReturnValue([]);

      await service.generate();

      // Get the workspace row that was inserted
      const workspacesInsertCall = clickhouse.insertSystem.mock.calls.find(
        (call) => call[0] === 'workspaces',
      );
      expect(workspacesInsertCall).toBeDefined();

      const workspaceRow = workspacesInsertCall![1][0] as { settings: string };

      // Verify settings is a JSON string
      expect(typeof workspaceRow.settings).toBe('string');

      // Parse and verify settings structure
      const settings = JSON.parse(workspaceRow.settings) as {
        timescore_reference: number;
        bounce_threshold: number;
        annotations: Array<{ title: string; timezone: string; color: string }>;
      };
      expect(settings.timescore_reference).toBe(180);
      expect(settings.bounce_threshold).toBe(10);
      expect(Array.isArray(settings.annotations)).toBe(true);
      expect(settings.annotations.length).toBeGreaterThan(0);

      // Verify iPhone launch annotation exists
      const launchAnnotation = settings.annotations.find(
        (a) => a.title === 'iPhone 16 Launch',
      );
      expect(launchAnnotation).toBeDefined();
      expect(launchAnnotation!.timezone).toBe('America/Los_Angeles');
      expect(launchAnnotation!.color).toBe('#22c55e');
    });

    it('inserts events in batches', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      // Generate mock events for 2 days
      const mockEvents = Array(100).fill({
        session_id: 'test',
        name: 'screen_view',
      });

      (generators.generateEventsByDay as jest.Mock).mockReturnValue([
        { date: '2025-01-01', events: mockEvents, sessionCount: 50 },
        { date: '2025-01-02', events: mockEvents, sessionCount: 50 },
      ]);

      await service.generate();

      expect(clickhouse.insertWorkspace).toHaveBeenCalledTimes(2);
    });

    it('returns summary with correct counts', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      const mockEvents = Array(10).fill({
        session_id: 'test',
        name: 'screen_view',
      });

      (generators.generateEventsByDay as jest.Mock).mockReturnValue([
        { date: '2025-01-01', events: mockEvents, sessionCount: 5 },
        { date: '2025-01-02', events: mockEvents, sessionCount: 5 },
      ]);

      const result = await service.generate();

      expect(result.workspace_id).toBe('demo-apple');
      expect(result.workspace_name).toBe('Apple Demo');
      expect(result.events_count).toBe(20);
      expect(result.sessions_count).toBe(10);
      expect(result.generation_time_seconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('delete', () => {
    it('returns success when demo workspace exists', async () => {
      clickhouse.querySystem.mockResolvedValue([{ id: 'demo-apple' }]);
      clickhouse.dropWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.commandSystem.mockResolvedValue(undefined);

      const result = await service.delete();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Demo workspace and database deleted');
      expect(clickhouse.dropWorkspaceDatabase).toHaveBeenCalledWith(
        'demo-apple',
      );
    });

    it('returns success with message when no demo workspace exists', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.delete();

      expect(result.success).toBe(true);
      expect(result.message).toBe('No demo workspace found');
      expect(clickhouse.dropWorkspaceDatabase).not.toHaveBeenCalled();
    });

    it('deletes workspace from system database', async () => {
      clickhouse.querySystem.mockResolvedValue([{ id: 'demo-apple' }]);
      clickhouse.dropWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.commandSystem.mockResolvedValue(undefined);

      await service.delete();

      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining("DELETE WHERE id = 'demo-apple'"),
      );
    });

    it('deletes backfill tasks from system database', async () => {
      clickhouse.querySystem.mockResolvedValue([{ id: 'demo-apple' }]);
      clickhouse.dropWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.commandSystem.mockResolvedValue(undefined);

      await service.delete();

      expect(clickhouse.commandSystem).toHaveBeenCalledWith(
        expect.stringContaining(
          "backfill_tasks DELETE WHERE workspace_id = 'demo-apple'",
        ),
      );
    });
  });

  describe('backfill task creation', () => {
    it('creates completed backfill task after generation', async () => {
      clickhouse.querySystem.mockResolvedValue([]);
      clickhouse.createWorkspaceDatabase.mockResolvedValue(undefined);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      clickhouse.insertWorkspace.mockResolvedValue(undefined);

      const mockEvents = Array(10).fill({
        session_id: 'test',
        name: 'screen_view',
      });

      (generators.generateEventsByDay as jest.Mock).mockReturnValue([
        { date: '2025-01-01', events: mockEvents, sessionCount: 5 },
      ]);

      await service.generate();

      // Should insert workspace and backfill task
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'backfill_tasks',
        expect.arrayContaining([
          expect.objectContaining({
            workspace_id: 'demo-apple',
            status: 'completed',
            total_sessions: 5,
            processed_sessions: 5,
            total_events: 10,
            processed_events: 10,
          }),
        ]),
      );
    });
  });
});
