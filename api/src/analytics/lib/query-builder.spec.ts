import { buildAnalyticsQuery, buildExtremesQuery } from './query-builder';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ExtremesQueryDto } from '../dto/extremes-query.dto';
import { MetricContext } from '../constants/metrics';

describe('buildAnalyticsQuery', () => {
  const baseQuery: AnalyticsQueryDto = {
    workspace_id: 'test-ws',
    metrics: ['sessions'],
    dateRange: { start: '2025-12-01', end: '2025-12-28' },
  };

  const defaultContext: MetricContext = {
    bounce_threshold: 10,
  };

  it('builds basic query with metrics only', () => {
    const { sql, params } = buildAnalyticsQuery(baseQuery);
    expect(sql).toContain('count() as sessions');
    expect(sql).toContain('FROM sessions FINAL');
    // workspace_id filter is no longer in query - queries run against workspace-specific database
    expect(sql).not.toContain('workspace_id');
    expect(params.date_start).toBe('2025-12-01');
    expect(params.date_end).toBe('2025-12-28');
  });

  it('includes multiple metrics', () => {
    const { sql } = buildAnalyticsQuery(
      {
        ...baseQuery,
        metrics: ['sessions', 'median_duration', 'bounce_rate'],
      },
      undefined,
      defaultContext,
    );
    expect(sql).toContain('count() as sessions');
    expect(sql).toContain(
      'round(median(duration) / 1000, 1) as median_duration',
    );
    expect(sql).toContain(
      'round(countIf(duration < 10000) * 100.0 / count(), 2) as bounce_rate',
    );
  });

  it('adds dimensions to SELECT and GROUP BY', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dimensions: ['utm_source', 'device'],
    });
    expect(sql).toContain('utm_source');
    expect(sql).toContain('device');
    expect(sql).toMatch(/GROUP BY.*utm_source.*device/s);
  });

  it('handles granularity day in SELECT and GROUP BY', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dateRange: {
        start: '2025-12-01',
        end: '2025-12-28',
        granularity: 'day',
      },
    });
    expect(sql).toContain('toDate(created_at) as date_day');
    expect(sql).toMatch(/GROUP BY.*date_day/);
    expect(sql).toMatch(/ORDER BY date_day ASC/);
  });

  it('handles granularity hour', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dateRange: {
        start: '2025-12-01',
        end: '2025-12-01',
        granularity: 'hour',
      },
    });
    expect(sql).toContain('toStartOfHour(created_at) as date_hour');
  });

  it('handles granularity week with Monday start', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dateRange: {
        start: '2025-12-01',
        end: '2025-12-28',
        granularity: 'week',
      },
    });
    // Mode 1 = Monday as first day of week (ISO week)
    expect(sql).toContain('toStartOfWeek(created_at, 1) as date_week');
  });

  it('handles granularity month', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dateRange: {
        start: '2025-10-01',
        end: '2025-12-28',
        granularity: 'month',
      },
    });
    expect(sql).toContain('toStartOfMonth(created_at) as date_month');
  });

  it('handles granularity year', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dateRange: {
        start: '2024-01-01',
        end: '2025-12-28',
        granularity: 'year',
      },
    });
    expect(sql).toContain('toStartOfYear(created_at) as date_year');
  });

  it('orders by granularity first, then custom order', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dimensions: ['utm_source'],
      dateRange: {
        start: '2025-12-01',
        end: '2025-12-28',
        granularity: 'day',
      },
      order: { sessions: 'desc' },
    });
    expect(sql).toMatch(/ORDER BY date_day ASC.*sessions DESC/s);
  });

  it('applies filters to WHERE clause', () => {
    const { sql, params } = buildAnalyticsQuery({
      ...baseQuery,
      filters: [
        { dimension: 'device', operator: 'equals', values: ['mobile'] },
      ],
    });
    expect(sql).toContain('device = {f0:String}');
    expect(params.f0).toBe('mobile');
  });

  it('applies multiple filters', () => {
    const { sql, params } = buildAnalyticsQuery({
      ...baseQuery,
      filters: [
        { dimension: 'device', operator: 'equals', values: ['mobile'] },
        {
          dimension: 'utm_source',
          operator: 'in',
          values: ['google', 'facebook'],
        },
      ],
    });
    expect(sql).toContain('device = {f0:String}');
    expect(sql).toContain('utm_source IN {f1:Array(String)}');
    expect(params.f0).toBe('mobile');
    expect(params.f1).toEqual(['google', 'facebook']);
  });

  it('defaults ORDER BY to first metric DESC when no order specified', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      metrics: ['median_duration', 'sessions'],
    });
    expect(sql).toContain('ORDER BY median_duration DESC');
  });

  it('respects custom order', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      order: { sessions: 'asc' },
    });
    expect(sql).toContain('ORDER BY sessions ASC');
  });

  it('respects limit', () => {
    const { sql } = buildAnalyticsQuery({ ...baseQuery, limit: 50 });
    expect(sql).toContain('LIMIT 50');
  });

  it('caps limit at 10000', () => {
    const { sql } = buildAnalyticsQuery({ ...baseQuery, limit: 50000 });
    expect(sql).toContain('LIMIT 10000');
  });

  it('defaults limit to 1000', () => {
    const { sql } = buildAnalyticsQuery(baseQuery);
    expect(sql).toContain('LIMIT 1000');
  });

  it('throws for unknown metric', () => {
    expect(() =>
      buildAnalyticsQuery({
        ...baseQuery,
        metrics: ['unknown_metric'],
      }),
    ).toThrow('Unknown metric: unknown_metric');
  });

  it('throws for unknown dimension', () => {
    expect(() =>
      buildAnalyticsQuery({
        ...baseQuery,
        dimensions: ['unknown_dimension'],
      }),
    ).toThrow('Unknown dimension: unknown_dimension');
  });

  it('throws for unknown order field', () => {
    expect(() =>
      buildAnalyticsQuery({
        ...baseQuery,
        order: { unknown_field: 'asc' },
      }),
    ).toThrow('Unknown order field: unknown_field');
  });

  it('combines granularity with dimensions', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dimensions: ['utm_source'],
      dateRange: {
        start: '2025-12-01',
        end: '2025-12-28',
        granularity: 'day',
      },
    });
    expect(sql).toContain('date_day');
    expect(sql).toContain('utm_source');
    expect(sql).toMatch(/GROUP BY.*date_day.*utm_source/s);
  });

  it('applies timezone to granularity grouping', () => {
    const { sql } = buildAnalyticsQuery(
      {
        ...baseQuery,
        dateRange: {
          start: '2025-12-01',
          end: '2025-12-28',
          granularity: 'day',
        },
      },
      'America/New_York',
    );
    expect(sql).toContain("toDate(created_at, 'America/New_York') as date_day");
  });

  it('applies timezone to week granularity', () => {
    const { sql } = buildAnalyticsQuery(
      {
        ...baseQuery,
        dateRange: {
          start: '2025-12-01',
          end: '2025-12-28',
          granularity: 'week',
        },
      },
      'Europe/London',
    );
    expect(sql).toContain(
      "toStartOfWeek(created_at, 1, 'Europe/London') as date_week",
    );
  });

  it('does not apply timezone when UTC', () => {
    const { sql } = buildAnalyticsQuery(
      {
        ...baseQuery,
        dateRange: {
          start: '2025-12-01',
          end: '2025-12-28',
          granularity: 'day',
        },
      },
      'UTC',
    );
    // No timezone suffix when UTC
    expect(sql).toContain('toDate(created_at) as date_day');
    expect(sql).not.toContain("toDate(created_at, 'UTC')");
  });

  it('adds HAVING clause when havingMinSessions specified', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dimensions: ['utm_source'],
      havingMinSessions: 10,
    });
    expect(sql).toContain('HAVING count() >= 10');
  });

  it('omits HAVING clause when havingMinSessions not specified', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      dimensions: ['utm_source'],
    });
    expect(sql).not.toContain('HAVING');
  });

  it('ignores havingMinSessions when no GROUP BY', () => {
    const { sql } = buildAnalyticsQuery({
      ...baseQuery,
      havingMinSessions: 10,
      // No dimensions, no granularity = no GROUP BY
    });
    expect(sql).not.toContain('HAVING');
  });

  describe('metricFilters', () => {
    it('adds metric filter to HAVING clause', () => {
      const { sql, params } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('HAVING');
      expect(sql).toContain('> {mf0:Float64}');
      expect(params.mf0).toBe(50);
    });

    it('combines metricFilters with havingMinSessions', () => {
      const { sql, params } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: ['utm_source'],
          havingMinSessions: 10,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('HAVING count() >= 10 AND');
      expect(sql).toContain('> {mf0:Float64}');
      expect(params.mf0).toBe(50);
    });

    it('handles multiple metric filters', () => {
      const { sql, params } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
            { metric: 'median_duration', operator: 'gte', values: [10] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('HAVING');
      expect(params.mf0).toBe(50);
      expect(params.mf1).toBe(10);
    });

    it('ignores metricFilters when no GROUP BY', () => {
      // This is the "totals" query pattern - no dimensions means no GROUP BY
      // metricFilters (HAVING clause) only work with GROUP BY, so they should be ignored
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
          // No dimensions, no granularity = no GROUP BY
        },
        undefined,
        defaultContext,
      );
      expect(sql).not.toContain('HAVING');
      expect(sql).not.toContain('GROUP BY');
    });

    it('ignores metricFilters for totals query (empty dimensions array)', () => {
      // Totals queries use dimensions: [] to get a single aggregate row
      // metricFilters should not apply - they would either hide the single row
      // or be invalid SQL (HAVING without GROUP BY)
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: [], // Explicitly empty - totals pattern
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
            { metric: 'median_duration', operator: 'gte', values: [10] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).not.toContain('HAVING');
      expect(sql).not.toContain('GROUP BY');
      // Query should still work and return aggregate metrics
      expect(sql).toContain('count() as sessions');
    });

    it('handles between operator in metricFilters', () => {
      const { sql, params } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'between', values: [20, 80] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('BETWEEN {mf0a:Float64} AND {mf0b:Float64}');
      expect(params.mf0a).toBe(20);
      expect(params.mf0b).toBe(80);
    });
  });

  describe('totalsGroupBy (filtered totals)', () => {
    it('uses subquery pattern when totalsGroupBy is set with metricFilters', () => {
      const { sql, params } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: [], // Empty = totals
          totalsGroupBy: ['utm_source'], // Group by this for filtering
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      // Should use subquery pattern
      expect(sql).toContain('FROM (');
      expect(sql).toContain('GROUP BY utm_source');
      expect(sql).toContain('HAVING');
      expect(sql).toContain('sum(_sessions)');
      expect(params.mf0).toBe(50);
    });

    it('aggregates sessions correctly in filtered totals', () => {
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          metrics: ['sessions'],
          dimensions: [],
          totalsGroupBy: ['device'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('count() as _sessions');
      expect(sql).toContain('sum(_sessions) as sessions');
    });

    it('recalculates bounce_rate correctly from underlying counts', () => {
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          metrics: ['bounce_rate'],
          dimensions: [],
          totalsGroupBy: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      // Should calculate from summed bounces/total
      expect(sql).toContain('countIf(duration < 10000) as _bounces');
      expect(sql).toContain('count() as _total');
      expect(sql).toContain('sum(_bounces) * 100.0 / sum(_total)');
    });

    it('uses quantileMerge for median metrics', () => {
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          metrics: ['median_duration'],
          dimensions: [],
          totalsGroupBy: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('quantileState(0.5)(duration)');
      expect(sql).toContain('quantileMerge(0.5)');
    });

    it('does not use subquery when totalsGroupBy is set but no metricFilters', () => {
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: [],
          totalsGroupBy: ['utm_source'],
          // No metricFilters
        },
        undefined,
        defaultContext,
      );
      // Should NOT use subquery - regular totals query
      expect(sql).not.toContain('FROM (');
    });

    it('does not use subquery when dimensions are present (not a totals query)', () => {
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: ['device'], // Has dimensions = not a totals query
          totalsGroupBy: ['utm_source'],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      // Should use regular grouped query, not subquery
      expect(sql).not.toContain('FROM (');
      expect(sql).toContain('GROUP BY device');
    });

    it('applies dimension filters in filtered totals', () => {
      const { sql, params } = buildAnalyticsQuery(
        {
          ...baseQuery,
          dimensions: [],
          totalsGroupBy: ['utm_source'],
          filters: [
            { dimension: 'device', operator: 'equals', values: ['mobile'] },
          ],
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        undefined,
        defaultContext,
      );
      expect(sql).toContain('device = {f0:String}');
      expect(params.f0).toBe('mobile');
    });
  });

  describe('table parameter', () => {
    it('defaults to sessions table', () => {
      const { sql } = buildAnalyticsQuery(baseQuery);
      expect(sql).toContain('FROM sessions FINAL');
    });

    it('queries sessions table explicitly', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'sessions',
      });
      expect(sql).toContain('FROM sessions FINAL');
      expect(sql).toContain('created_at >= toDateTime64');
    });

    it('queries pages table with FINAL modifier', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'pages',
        metrics: ['page_count'],
      });
      expect(sql).toContain('FROM pages FINAL');
      expect(sql).toContain('entered_at >= toDateTime64');
    });

    it('uses entered_at for pages table date filtering', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'pages',
        metrics: ['page_count'],
      });
      expect(sql).toContain(
        "entered_at >= toDateTime64({date_start:String}, 3, 'UTC')",
      );
      expect(sql).toContain(
        "entered_at <= toDateTime64({date_end:String}, 3, 'UTC')",
      );
    });

    it('uses created_at for sessions table date filtering', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'sessions',
      });
      expect(sql).toContain(
        "created_at >= toDateTime64({date_start:String}, 3, 'UTC')",
      );
      expect(sql).toContain(
        "created_at <= toDateTime64({date_end:String}, 3, 'UTC')",
      );
    });

    it('applies granularity with correct date column for pages', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'pages',
        metrics: ['page_count'],
        dateRange: {
          start: '2025-12-01',
          end: '2025-12-28',
          granularity: 'day',
        },
      });
      expect(sql).toContain('toDate(entered_at) as date_day');
    });

    it('applies timezone to granularity for pages table', () => {
      const { sql } = buildAnalyticsQuery(
        {
          ...baseQuery,
          table: 'pages',
          metrics: ['page_count'],
          dateRange: {
            start: '2025-12-01',
            end: '2025-12-28',
            granularity: 'day',
          },
        },
        'America/New_York',
      );
      expect(sql).toContain(
        "toDate(entered_at, 'America/New_York') as date_day",
      );
    });

    it('throws for sessions metric on pages table', () => {
      expect(() =>
        buildAnalyticsQuery({
          ...baseQuery,
          table: 'pages',
          metrics: ['sessions'],
        }),
      ).toThrow("Metric 'sessions' is not available for table 'pages'");
    });

    it('throws for page_count metric on sessions table', () => {
      expect(() =>
        buildAnalyticsQuery({
          ...baseQuery,
          table: 'sessions',
          metrics: ['page_count'],
        }),
      ).toThrow("Metric 'page_count' is not available for table 'sessions'");
    });

    it('throws for sessions dimension on pages table', () => {
      expect(() =>
        buildAnalyticsQuery({
          ...baseQuery,
          table: 'pages',
          metrics: ['page_count'],
          dimensions: ['utm_source'],
        }),
      ).toThrow("Dimension 'utm_source' is not available for table 'pages'");
    });

    it('throws for pages dimension on sessions table', () => {
      expect(() =>
        buildAnalyticsQuery({
          ...baseQuery,
          table: 'sessions',
          metrics: ['sessions'],
          dimensions: ['page_path'],
        }),
      ).toThrow("Dimension 'page_path' is not available for table 'sessions'");
    });

    it('builds query with page-specific metrics', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'pages',
        metrics: ['page_count', 'page_duration', 'page_scroll'],
      });
      expect(sql).toContain('count() as page_count');
      expect(sql).toContain(
        'round(median(duration) / 1000, 1) as page_duration',
      );
      expect(sql).toContain('round(median(max_scroll), 1) as page_scroll');
    });

    it('builds query with page-specific dimensions', () => {
      const { sql } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'pages',
        metrics: ['page_count'],
        dimensions: ['page_path', 'is_landing_page'],
      });
      expect(sql).toContain('path');
      expect(sql).toContain('is_landing');
      expect(sql).toMatch(/GROUP BY.*path.*is_landing/s);
    });

    it('applies filters with correct table validation', () => {
      const { sql, params } = buildAnalyticsQuery({
        ...baseQuery,
        table: 'pages',
        metrics: ['page_count'],
        filters: [
          { dimension: 'page_path', operator: 'equals', values: ['/products'] },
        ],
      });
      expect(sql).toContain('path = {f0:String}');
      expect(params.f0).toBe('/products');
    });
  });
});

describe('buildExtremesQuery', () => {
  const baseExtremesQuery: ExtremesQueryDto & {
    dateRange: { start: string; end: string };
  } = {
    workspace_id: 'test-ws',
    metric: 'median_duration',
    groupBy: ['utm_source'],
    dateRange: { start: '2025-12-01', end: '2025-12-28' },
  };

  it('builds min/max query with dimension values that achieved max', () => {
    const { sql, params } = buildExtremesQuery(baseExtremesQuery);

    // Outer query should select min, max, and dimension values from max_row
    expect(sql).toContain('sub.min as min');
    expect(sql).toContain('sub.max as max');
    expect(sql).toContain('max_row.utm_source');

    // Should have LEFT JOIN to find dimension values that achieved max
    expect(sql).toContain('LEFT JOIN');
    expect(sql).toContain('ON max_row.value = sub.max');

    // Inner grouped query structure
    expect(sql).toContain('GROUP BY utm_source');
    expect(sql).toContain('LIMIT 1');

    expect(params.date_start).toBe('2025-12-01');
    expect(params.date_end).toBe('2025-12-28');
  });

  it('includes correct metric SQL in inner query', () => {
    const { sql } = buildExtremesQuery(baseExtremesQuery);

    // median_duration uses: round(median(duration) / 1000, 1)
    expect(sql).toContain('round(median(duration) / 1000, 1) as value');
  });

  it('handles sessions metric', () => {
    const { sql } = buildExtremesQuery({
      ...baseExtremesQuery,
      metric: 'sessions',
    });

    expect(sql).toContain('count() as value');
  });

  it('includes HAVING in both subqueries when havingMinSessions specified', () => {
    const { sql } = buildExtremesQuery({
      ...baseExtremesQuery,
      havingMinSessions: 10,
    });

    expect(sql).toContain('HAVING count() >= 10');
    // HAVING should appear twice: once in the grouped subquery for min/max,
    // and once in the max_row join subquery
    const havingMatches = sql.match(/HAVING count\(\) >= 10/g);
    expect(havingMatches).toHaveLength(2);
  });

  it('omits HAVING when havingMinSessions not specified', () => {
    const { sql } = buildExtremesQuery(baseExtremesQuery);

    expect(sql).not.toContain('HAVING');
  });

  it('applies filters to both subqueries', () => {
    const { sql, params } = buildExtremesQuery({
      ...baseExtremesQuery,
      filters: [
        { dimension: 'device', operator: 'equals', values: ['mobile'] },
      ],
    });

    expect(sql).toContain('device = {f0:String}');
    expect(params.f0).toBe('mobile');
    // Filter should appear twice: once in grouped subquery, once in max_row join
    const filterMatches = sql.match(/device = \{f0:String\}/g);
    expect(filterMatches).toHaveLength(2);
  });

  it('handles multiple groupBy dimensions', () => {
    const { sql } = buildExtremesQuery({
      ...baseExtremesQuery,
      groupBy: ['utm_source', 'device'],
    });

    expect(sql).toContain('GROUP BY utm_source, device');
    // Should include all dimension values from max_row in SELECT
    expect(sql).toContain('max_row.utm_source, max_row.device');
  });

  it('throws for unknown metric', () => {
    expect(() =>
      buildExtremesQuery({
        ...baseExtremesQuery,
        metric: 'unknown_metric',
      }),
    ).toThrow('Unknown metric: unknown_metric');
  });

  it('throws for unknown dimension in groupBy', () => {
    expect(() =>
      buildExtremesQuery({
        ...baseExtremesQuery,
        groupBy: ['unknown_dimension'],
      }),
    ).toThrow('Unknown dimension: unknown_dimension');
  });

  describe('metricFilters', () => {
    const defaultContext: MetricContext = { bounce_threshold: 10 };

    it('includes metricFilters in HAVING clause', () => {
      const { sql, params } = buildExtremesQuery(
        {
          ...baseExtremesQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        defaultContext,
      );
      expect(sql).toContain('HAVING');
      expect(sql).toContain('> {mf0:Float64}');
      expect(params.mf0).toBe(50);
    });

    it('applies metricFilters to both subqueries', () => {
      const { sql, params } = buildExtremesQuery(
        {
          ...baseExtremesQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        defaultContext,
      );
      // HAVING should appear twice: once in grouped subquery, once in max_row join
      const havingMatches = sql.match(/HAVING/g);
      expect(havingMatches).toHaveLength(2);
      expect(params.mf0).toBe(50);
    });

    it('combines metricFilters with havingMinSessions', () => {
      const { sql, params } = buildExtremesQuery(
        {
          ...baseExtremesQuery,
          havingMinSessions: 10,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
          ],
        },
        defaultContext,
      );
      expect(sql).toContain('HAVING count() >= 10 AND');
      expect(params.mf0).toBe(50);
    });

    it('handles multiple metric filters', () => {
      const { sql, params } = buildExtremesQuery(
        {
          ...baseExtremesQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'gt', values: [50] },
            { metric: 'median_duration', operator: 'gte', values: [10] },
          ],
        },
        defaultContext,
      );
      expect(sql).toContain('HAVING');
      expect(params.mf0).toBe(50);
      expect(params.mf1).toBe(10);
    });

    it('handles between operator', () => {
      const { sql, params } = buildExtremesQuery(
        {
          ...baseExtremesQuery,
          metricFilters: [
            { metric: 'bounce_rate', operator: 'between', values: [20, 80] },
          ],
        },
        defaultContext,
      );
      expect(sql).toContain('BETWEEN {mf0a:Float64} AND {mf0b:Float64}');
      expect(params.mf0a).toBe(20);
      expect(params.mf0b).toBe(80);
    });
  });

  describe('table parameter', () => {
    it('defaults to sessions table', () => {
      const { sql } = buildExtremesQuery(baseExtremesQuery);
      expect(sql).toContain('FROM sessions FINAL');
    });

    it('queries pages table with FINAL modifier', () => {
      const { sql } = buildExtremesQuery({
        ...baseExtremesQuery,
        table: 'pages',
        metric: 'page_duration',
        groupBy: ['page_path'],
      });
      expect(sql).toContain('FROM pages FINAL');
    });

    it('uses entered_at for pages table date filtering', () => {
      const { sql } = buildExtremesQuery({
        ...baseExtremesQuery,
        table: 'pages',
        metric: 'page_duration',
        groupBy: ['page_path'],
      });
      expect(sql).toContain(
        "entered_at >= toDateTime64({date_start:String}, 3, 'UTC')",
      );
      expect(sql).toContain(
        "entered_at <= toDateTime64({date_end:String}, 3, 'UTC')",
      );
    });

    it('throws for sessions metric on pages table', () => {
      expect(() =>
        buildExtremesQuery({
          ...baseExtremesQuery,
          table: 'pages',
          metric: 'sessions',
          groupBy: ['page_path'],
        }),
      ).toThrow("Metric 'sessions' is not available for table 'pages'");
    });

    it('throws for page_duration metric on sessions table', () => {
      expect(() =>
        buildExtremesQuery({
          ...baseExtremesQuery,
          table: 'sessions',
          metric: 'page_duration',
        }),
      ).toThrow("Metric 'page_duration' is not available for table 'sessions'");
    });

    it('throws for sessions dimension on pages table', () => {
      expect(() =>
        buildExtremesQuery({
          ...baseExtremesQuery,
          table: 'pages',
          metric: 'page_duration',
          groupBy: ['utm_source'],
        }),
      ).toThrow("Dimension 'utm_source' is not available for table 'pages'");
    });

    it('throws for pages dimension on sessions table', () => {
      expect(() =>
        buildExtremesQuery({
          ...baseExtremesQuery,
          table: 'sessions',
          groupBy: ['page_path'],
        }),
      ).toThrow("Dimension 'page_path' is not available for table 'sessions'");
    });

    it('builds extremes query with page-specific metrics', () => {
      const { sql } = buildExtremesQuery({
        ...baseExtremesQuery,
        table: 'pages',
        metric: 'page_duration',
        groupBy: ['page_path'],
      });
      expect(sql).toContain('round(median(duration) / 1000, 1) as value');
      expect(sql).toContain('GROUP BY path');
    });
  });
});
