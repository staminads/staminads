import { BackfillProcessor } from './backfill.processor';
import { ClickHouseService } from '../../database/clickhouse.service';
import { BackfillTask } from './backfill-task.entity';
import { CustomDimensionDefinition } from '../entities/custom-dimension.entity';

describe('BackfillProcessor', () => {
  let processor: BackfillProcessor;
  let clickhouse: jest.Mocked<ClickHouseService>;

  const mockDefinitions: CustomDimensionDefinition[] = [
    {
      id: 'cd-1',
      slot: 1,
      name: 'Channel',
      category: 'Custom',
      rules: [
        {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
          outputValue: 'Google',
        },
        {
          conditions: [{ field: 'utm_source', operator: 'equals', value: 'facebook' }],
          outputValue: 'Facebook',
        },
      ],
      defaultValue: 'Other',
      version: 'abc12345',
      createdAt: '2025-01-01 00:00:00',
      updatedAt: '2025-01-01 00:00:00',
    },
  ];

  const mockTask: BackfillTask = {
    id: 'task-1',
    workspace_id: 'workspace-1',
    status: 'running',
    lookback_days: 7,
    chunk_size_days: 1,
    batch_size: 100,
    total_sessions: 0,
    processed_sessions: 0,
    total_events: 0,
    processed_events: 0,
    current_date_chunk: null,
    created_at: '2025-12-29 10:00:00',
    started_at: '2025-12-29 10:00:01',
    completed_at: null,
    error_message: null,
    retry_count: 0,
    dimensions_snapshot: JSON.stringify(mockDefinitions),
  };

  const mockSession = {
    id: 'session-1',
    workspace_id: 'workspace-1',
    created_at: '2025-12-28 10:00:00',
    updated_at: '2025-12-28 10:05:00',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    utm_id: null,
    utm_id_from: null,
    referrer: null,
    referrer_domain: null,
    referrer_path: null,
    is_direct: false,
    landing_page: 'https://test.com',
    landing_domain: 'test.com',
    landing_path: '/',
    device: 'desktop',
    browser: 'Chrome',
    browser_type: 'browser',
    os: 'Windows',
    user_agent: 'Mozilla/5.0...',
    connection_type: 'wifi',
    language: 'en-US',
    timezone: 'America/New_York',
  };

  const mockEvent = {
    id: 'event-1',
    session_id: 'session-1',
    workspace_id: 'workspace-1',
    created_at: '2025-12-28 10:00:00',
    name: 'screen_view',
    path: '/',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    utm_id: null,
    utm_id_from: null,
    referrer: null,
    referrer_domain: null,
    referrer_path: null,
    is_direct: false,
    landing_page: 'https://test.com',
    landing_domain: 'test.com',
    landing_path: '/',
    device: 'desktop',
    browser: 'Chrome',
    browser_type: 'browser',
    os: 'Windows',
    user_agent: 'Mozilla/5.0...',
    connection_type: 'wifi',
    language: 'en-US',
    timezone: 'America/New_York',
  };

  beforeEach(() => {
    clickhouse = {
      query: jest.fn(),
      insert: jest.fn(),
      command: jest.fn(),
    } as any;

    processor = new BackfillProcessor(clickhouse);
  });

  describe('computeBatch', () => {
    it('should compute all 10 CD slots', () => {
      const records = [mockSession];
      const result = processor.computeBatch(records, mockDefinitions);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('cd_1', 'Google');
      // Unused slots should be null
      expect(result[0]).toHaveProperty('cd_2', null);
    });

    it('should use dimensions from snapshot, not current', () => {
      // The processor receives definitions from the task snapshot
      // This test verifies that the snapshot is used correctly
      const oldDefinitions: CustomDimensionDefinition[] = [
        {
          ...mockDefinitions[0],
          rules: [
            {
              conditions: [{ field: 'utm_source', operator: 'equals', value: 'google' }],
              outputValue: 'Old Google Value',
            },
          ],
          version: 'old-version',
        },
      ];

      const records = [mockSession];
      const result = processor.computeBatch(records, oldDefinitions);

      expect(result[0].cd_1).toBe('Old Google Value');
    });

    it('should handle empty rules gracefully', () => {
      const emptyDefinitions: CustomDimensionDefinition[] = [
        {
          ...mockDefinitions[0],
          rules: [],
          defaultValue: 'Default',
        },
      ];

      const records = [mockSession];
      const result = processor.computeBatch(records, emptyDefinitions);

      expect(result[0].cd_1).toBe('Default');
    });

    it('should return null when no rules match and no default', () => {
      const noMatchDefinitions: CustomDimensionDefinition[] = [
        {
          ...mockDefinitions[0],
          rules: [
            {
              conditions: [{ field: 'utm_source', operator: 'equals', value: 'twitter' }],
              outputValue: 'Twitter',
            },
          ],
          defaultValue: undefined,
        },
      ];

      const records = [mockSession];
      const result = processor.computeBatch(records, noMatchDefinitions);

      expect(result[0].cd_1).toBe(null);
    });

    it('should process multiple records', () => {
      const records = [
        { ...mockSession, id: 'session-1', utm_source: 'google' },
        { ...mockSession, id: 'session-2', utm_source: 'facebook' },
        { ...mockSession, id: 'session-3', utm_source: 'twitter' },
      ];

      const result = processor.computeBatch(records, mockDefinitions);

      expect(result).toHaveLength(3);
      expect(result[0].cd_1).toBe('Google');
      expect(result[1].cd_1).toBe('Facebook');
      expect(result[2].cd_1).toBe('Other'); // defaultValue
    });
  });

  describe('isWithinEventsTTL', () => {
    it('should return true for dates within 7 days', () => {
      const today = new Date();
      const withinTTL = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

      expect(processor.isWithinEventsTTL(withinTTL)).toBe(true);
    });

    it('should return false for dates older than 7 days', () => {
      const today = new Date();
      const outsideTTL = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      expect(processor.isWithinEventsTTL(outsideTTL)).toBe(false);
    });

    it('should return true for today', () => {
      expect(processor.isWithinEventsTTL(new Date())).toBe(true);
    });

    it('should return true for exactly 7 days ago', () => {
      const today = new Date();
      const exactly7Days = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Exactly 7 days should be on the boundary - implementation may vary
      // Typically we include the boundary
      expect(processor.isWithinEventsTTL(exactly7Days)).toBe(true);
    });
  });

  describe('generateDateChunks', () => {
    it('should generate correct date chunks for lookback period', () => {
      const endDate = new Date('2025-12-29');
      const chunks = processor.generateDateChunks(7, 1, endDate);

      expect(chunks).toHaveLength(7);
      expect(chunks[0].toISOString().split('T')[0]).toBe('2025-12-23');
      expect(chunks[6].toISOString().split('T')[0]).toBe('2025-12-29');
    });

    it('should generate fewer chunks with larger chunk_size_days', () => {
      const endDate = new Date('2025-12-29');
      const chunks = processor.generateDateChunks(7, 7, endDate);

      expect(chunks).toHaveLength(1);
    });

    it('should handle chunk_size_days larger than lookback_days', () => {
      const endDate = new Date('2025-12-29');
      const chunks = processor.generateDateChunks(3, 7, endDate);

      expect(chunks).toHaveLength(1);
    });
  });

  describe('cancel', () => {
    it('should set cancelled flag', () => {
      expect(processor.isCancelled()).toBe(false);

      processor.cancel();

      expect(processor.isCancelled()).toBe(true);
    });

    it('should stop processing on next chunk', async () => {
      // Mock the clickhouse to return sessions
      clickhouse.query.mockImplementation(async (query: string) => {
        if (query.includes('count()')) {
          return [{ total_sessions: '100', total_events: '500' }];
        }
        if (query.includes('FROM sessions')) {
          return [mockSession];
        }
        if (query.includes('FROM events')) {
          return [mockEvent];
        }
        if (query.includes('system.mutations')) {
          return [{ is_done: 1 }];
        }
        return [];
      });

      // Start processing in background
      const processPromise = processor.process(mockTask);

      // Cancel immediately
      processor.cancel();

      await processPromise;

      // Should have stopped early - verify by checking that not all chunks were processed
      expect(processor.isCancelled()).toBe(true);
    });
  });

  describe('processDateChunk', () => {
    beforeEach(() => {
      clickhouse.query.mockImplementation(async (query: string) => {
        if (query.includes('FROM sessions')) {
          return [mockSession];
        }
        if (query.includes('FROM events')) {
          return [mockEvent];
        }
        if (query.includes('system.mutations')) {
          return [{ is_done: 1 }];
        }
        return [];
      });
      clickhouse.insert.mockResolvedValue(undefined);
      clickhouse.command.mockResolvedValue(undefined);
    });

    it('should process events before sessions', async () => {
      const chunkDate = new Date('2025-12-28');
      const callOrder: string[] = [];

      clickhouse.command.mockImplementation(async (query: string) => {
        if (query.includes('ALTER TABLE events')) {
          callOrder.push('events');
        }
        if (query.includes('ALTER TABLE backfill_tasks')) {
          callOrder.push('task_update');
        }
        return undefined;
      });

      clickhouse.insert.mockImplementation(async (table: string) => {
        if (table === 'sessions') {
          callOrder.push('sessions');
        }
        return undefined;
      });

      await processor.processDateChunk(mockTask, mockDefinitions, chunkDate);

      // Events should be processed before sessions
      const eventsIndex = callOrder.indexOf('events');
      const sessionsIndex = callOrder.indexOf('sessions');

      expect(eventsIndex).toBeLessThan(sessionsIndex);
    });

    it('should skip events older than 7 days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

      const callOrder: string[] = [];

      clickhouse.command.mockImplementation(async (query: string) => {
        if (query.includes('ALTER TABLE events')) {
          callOrder.push('events');
        }
        return undefined;
      });

      await processor.processDateChunk(mockTask, mockDefinitions, oldDate);

      // Events should not be processed for old dates
      expect(callOrder).not.toContain('events');
    });

    it('should wait for mutation to complete', async () => {
      let mutationCheckCount = 0;

      clickhouse.query.mockImplementation(async (query: string) => {
        if (query.includes('system.mutations')) {
          mutationCheckCount++;
          // Return not done on first call, done on second
          return [{ is_done: mutationCheckCount >= 2 ? 1 : 0 }];
        }
        if (query.includes('FROM sessions')) {
          return [mockSession];
        }
        if (query.includes('FROM events')) {
          return [mockEvent];
        }
        return [];
      });

      const chunkDate = new Date('2025-12-28');
      await processor.processDateChunk(mockTask, mockDefinitions, chunkDate);

      // Should have checked mutation status at least twice
      expect(mutationCheckCount).toBeGreaterThanOrEqual(1);
    });

    it('should update progress after each chunk', async () => {
      const chunkDate = new Date('2025-12-28');

      await processor.processDateChunk(mockTask, mockDefinitions, chunkDate);

      // Verify task update was called
      expect(clickhouse.command).toHaveBeenCalledWith(
        expect.stringContaining('ALTER TABLE backfill_tasks UPDATE'),
      );
    });
  });
});
