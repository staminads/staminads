import { BadRequestException } from '@nestjs/common';
import { ToolExecutor } from './tool-executor';
import { AnalyticsService } from '../../analytics/analytics.service';

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let analyticsService: jest.Mocked<AnalyticsService>;
  const workspaceId = 'ws-123';

  beforeEach(() => {
    analyticsService = {
      query: jest.fn(),
    } as unknown as jest.Mocked<AnalyticsService>;
    executor = new ToolExecutor(analyticsService, workspaceId);
  });

  describe('execute', () => {
    it('throws BadRequestException for unknown tool', async () => {
      await expect(
        executor.execute('unknown_tool' as never, {}),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('unknown_tool' as never, {}),
      ).rejects.toThrow(/Unknown tool/);
    });
  });

  describe('get_dimension_values', () => {
    it('throws BadRequestException for unknown dimension', async () => {
      await expect(
        executor.execute('get_dimension_values', {
          dimension: 'invalid_dimension',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('get_dimension_values', {
          dimension: 'invalid_dimension',
        }),
      ).rejects.toThrow(/Unknown dimension/);
    });

    it('throws BadRequestException for invalid period', async () => {
      await expect(
        executor.execute('get_dimension_values', {
          dimension: 'device',
          period: 'invalid_period',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('get_dimension_values', {
          dimension: 'device',
          period: 'invalid_period',
        }),
      ).rejects.toThrow(/Invalid period/);
    });

    it('queries analytics service with correct parameters', async () => {
      analyticsService.query.mockResolvedValue({
        data: [
          { device: 'mobile', sessions: 100 },
          { device: 'desktop', sessions: 50 },
        ],
        meta: {
          total_rows: 2,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('get_dimension_values', {
        dimension: 'device',
        period: 'previous_7_days',
        limit: 10,
      })) as {
        dimension: string;
        values: Array<{ value: string; sessions: number }>;
        total_unique: number;
      };

      expect(analyticsService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: workspaceId,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { preset: 'previous_7_days' },
        }),
      );

      expect(result.dimension).toBe('device');
      expect(result.values).toHaveLength(2);
      expect(result.values[0]).toEqual({ value: 'mobile', sessions: 100 });
    });

    it('filters values by search term', async () => {
      analyticsService.query.mockResolvedValue({
        data: [
          { browser: 'Chrome Mobile', sessions: 100 },
          { browser: 'Chrome Desktop', sessions: 50 },
          { browser: 'Firefox', sessions: 30 },
        ],
        meta: {
          total_rows: 3,
          metrics: ['sessions'],
          dimensions: ['browser'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('get_dimension_values', {
        dimension: 'browser',
        search: 'chrome',
      })) as { values: Array<{ value: string }> };

      expect(result.values).toHaveLength(2);
      expect(
        result.values.every((v) => v.value?.toLowerCase().includes('chrome')),
      ).toBe(true);
    });

    it('limits results to specified limit (max 100)', async () => {
      analyticsService.query.mockResolvedValue({
        data: Array.from({ length: 200 }, (_, i) => ({
          browser: `Browser ${i}`,
          sessions: 200 - i,
        })),
        meta: {
          total_rows: 200,
          metrics: ['sessions'],
          dimensions: ['browser'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('get_dimension_values', {
        dimension: 'browser',
        limit: 150, // Requested 150, should cap at 100
      })) as { values: unknown[] };

      expect(result.values.length).toBeLessThanOrEqual(100);
    });

    it('wraps query errors in BadRequestException', async () => {
      analyticsService.query.mockRejectedValue(new Error('Database error'));

      await expect(
        executor.execute('get_dimension_values', { dimension: 'device' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('get_dimension_values', { dimension: 'device' }),
      ).rejects.toThrow(/Failed to get dimension values/);
    });
  });

  describe('preview_query', () => {
    it('throws BadRequestException for more than 3 dimensions', async () => {
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device', 'browser', 'os', 'utm_source'],
          period: 'previous_7_days',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device', 'browser', 'os', 'utm_source'],
          period: 'previous_7_days',
        }),
      ).rejects.toThrow(/limited to 3 dimensions/);
    });

    it('throws BadRequestException when period is missing', async () => {
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device'],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device'],
        }),
      ).rejects.toThrow(/Period is required/);
    });

    it('throws BadRequestException for invalid period', async () => {
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device'],
          period: 'invalid',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device'],
          period: 'invalid',
        }),
      ).rejects.toThrow(/Invalid period/);
    });

    it('throws BadRequestException for unknown dimension', async () => {
      await expect(
        executor.execute('preview_query', {
          dimensions: ['invalid_dim'],
          period: 'previous_7_days',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('preview_query', {
          dimensions: ['invalid_dim'],
          period: 'previous_7_days',
        }),
      ).rejects.toThrow(/Unknown dimension/);
    });

    it('returns preview results with row count and sample data', async () => {
      analyticsService.query.mockResolvedValue({
        data: [
          { device: 'mobile', sessions: 100, median_duration: 45 },
          { device: 'desktop', sessions: 50, median_duration: 30 },
        ],
        meta: {
          total_rows: 10,
          metrics: ['sessions', 'median_duration'],
          dimensions: ['device'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('preview_query', {
        dimensions: ['device'],
        period: 'previous_7_days',
      })) as {
        row_count: number;
        sample_data: unknown[];
        dimensions_used: string[];
      };

      expect(result.row_count).toBe(10);
      expect(result.sample_data).toHaveLength(2);
      expect(result.dimensions_used).toEqual(['device']);
    });

    it('limits sample data to 5 rows', async () => {
      analyticsService.query.mockResolvedValue({
        data: Array.from({ length: 20 }, (_, i) => ({
          device: `Device ${i}`,
          sessions: 100 - i,
        })),
        meta: {
          total_rows: 20,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('preview_query', {
        dimensions: ['device'],
        period: 'previous_7_days',
      })) as { sample_data: unknown[] };

      expect(result.sample_data).toHaveLength(5);
    });

    it('wraps query errors in BadRequestException', async () => {
      analyticsService.query.mockRejectedValue(new Error('Query timeout'));

      await expect(
        executor.execute('preview_query', {
          dimensions: ['device'],
          period: 'previous_7_days',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('preview_query', {
          dimensions: ['device'],
          period: 'previous_7_days',
        }),
      ).rejects.toThrow(/Query failed/);
    });

    it('passes metricFilters to analytics query', async () => {
      analyticsService.query.mockResolvedValue({
        data: [{ device: 'mobile', sessions: 100, bounce_rate: 60 }],
        meta: {
          total_rows: 1,
          metrics: ['sessions', 'bounce_rate'],
          dimensions: ['device'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('preview_query', {
        dimensions: ['device'],
        period: 'previous_7_days',
        metricFilters: [
          { metric: 'bounce_rate', operator: 'gt', values: [50] },
        ],
      })) as {
        row_count: number;
        metric_filters_applied: number;
      };

      expect(analyticsService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        }),
      );
      expect(result.metric_filters_applied).toBe(1);
    });

    it('returns metric_filters_applied count of 0 when no metricFilters', async () => {
      analyticsService.query.mockResolvedValue({
        data: [{ device: 'mobile', sessions: 100 }],
        meta: {
          total_rows: 1,
          metrics: ['sessions'],
          dimensions: ['device'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      const result = (await executor.execute('preview_query', {
        dimensions: ['device'],
        period: 'previous_7_days',
      })) as { metric_filters_applied: number };

      expect(result.metric_filters_applied).toBe(0);
    });

    it('queries all filterable metrics for preview', async () => {
      analyticsService.query.mockResolvedValue({
        data: [],
        meta: {
          total_rows: 0,
          metrics: [
            'sessions',
            'bounce_rate',
            'median_duration',
            'median_scroll',
          ],
          dimensions: ['device'],
          dateRange: { start: '2025-01-01', end: '2025-01-07' },
        },
        query: { sql: 'SELECT ...', params: {} },
      });

      await executor.execute('preview_query', {
        dimensions: ['device'],
        period: 'previous_7_days',
      });

      expect(analyticsService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: [
            'sessions',
            'bounce_rate',
            'median_duration',
            'median_scroll',
          ],
        }),
      );
    });
  });

  describe('configure_explore', () => {
    it('returns success with config object', async () => {
      const result = (await executor.execute('configure_explore', {
        dimensions: ['device', 'browser'],
        period: 'previous_7_days',
        comparison: 'previous_period',
      })) as { success: boolean; config: unknown };

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
    });

    it('throws BadRequestException for more than 5 dimensions', async () => {
      await expect(
        executor.execute('configure_explore', {
          dimensions: [
            'device',
            'browser',
            'os',
            'utm_source',
            'utm_medium',
            'utm_campaign',
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('configure_explore', {
          dimensions: [
            'device',
            'browser',
            'os',
            'utm_source',
            'utm_medium',
            'utm_campaign',
          ],
        }),
      ).rejects.toThrow(/Maximum 5 dimensions/);
    });

    it('throws BadRequestException for unknown dimension', async () => {
      await expect(
        executor.execute('configure_explore', {
          dimensions: ['invalid_dimension'],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('configure_explore', {
          dimensions: ['invalid_dimension'],
        }),
      ).rejects.toThrow(/Unknown dimension/);
    });

    it('throws BadRequestException for invalid period', async () => {
      await expect(
        executor.execute('configure_explore', {
          period: 'invalid_period',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('configure_explore', {
          period: 'invalid_period',
        }),
      ).rejects.toThrow(/Invalid period/);
    });

    it('throws BadRequestException for invalid comparison', async () => {
      await expect(
        executor.execute('configure_explore', {
          comparison: 'invalid_comparison',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        executor.execute('configure_explore', {
          comparison: 'invalid_comparison',
        }),
      ).rejects.toThrow(/Invalid comparison/);
    });

    it('coerces minSessions string to number', async () => {
      const result = (await executor.execute('configure_explore', {
        minSessions: '10', // String instead of number
      })) as { config: { minSessions: number } };

      expect(result.config.minSessions).toBe(10);
    });

    it('includes filters in config', async () => {
      const result = (await executor.execute('configure_explore', {
        filters: [{ dimension: 'device', operator: 'eq', values: ['mobile'] }],
      })) as { config: { filters: unknown[] } };

      expect(result.config.filters).toBeDefined();
      expect(result.config.filters).toHaveLength(1);
    });

    it('includes custom date range in config', async () => {
      const result = (await executor.execute('configure_explore', {
        customStart: '2025-01-01',
        customEnd: '2025-01-31',
      })) as { config: { customStart: string; customEnd: string } };

      expect(result.config.customStart).toBe('2025-01-01');
      expect(result.config.customEnd).toBe('2025-01-31');
    });

    it('includes metricFilters in config', async () => {
      const result = (await executor.execute('configure_explore', {
        dimensions: ['device'],
        metricFilters: [
          { metric: 'bounce_rate', operator: 'gt', values: [50] },
          { metric: 'median_duration', operator: 'gte', values: [60] },
        ],
      })) as {
        config: {
          metricFilters: Array<{
            metric: string;
            operator: string;
            values: number[];
          }>;
        };
      };

      expect(result.config.metricFilters).toBeDefined();
      expect(result.config.metricFilters).toHaveLength(2);
      expect(result.config.metricFilters[0]).toEqual({
        metric: 'bounce_rate',
        operator: 'gt',
        values: [50],
      });
      expect(result.config.metricFilters[1]).toEqual({
        metric: 'median_duration',
        operator: 'gte',
        values: [60],
      });
    });

    it('includes metricFilters with between operator', async () => {
      const result = (await executor.execute('configure_explore', {
        metricFilters: [
          { metric: 'median_scroll', operator: 'between', values: [25, 75] },
        ],
      })) as {
        config: {
          metricFilters: Array<{
            metric: string;
            operator: string;
            values: number[];
          }>;
        };
      };

      expect(result.config.metricFilters).toHaveLength(1);
      expect(result.config.metricFilters[0]).toEqual({
        metric: 'median_scroll',
        operator: 'between',
        values: [25, 75],
      });
    });

    it('returns undefined metricFilters when not provided', async () => {
      const result = (await executor.execute('configure_explore', {
        dimensions: ['device'],
      })) as { config: { metricFilters?: unknown } };

      expect(result.config.metricFilters).toBeUndefined();
    });
  });
});
