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
        metrics: ['sessions', 'avg_duration', 'bounce_rate'],
      },
      undefined,
      defaultContext,
    );
    expect(sql).toContain('count() as sessions');
    expect(sql).toContain('round(avg(duration), 1) as avg_duration');
    expect(sql).toContain(
      'round(countIf(duration < 10) * 100.0 / count(), 2) as bounce_rate',
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
      filters: [{ dimension: 'device', operator: 'equals', values: ['mobile'] }],
    });
    expect(sql).toContain('device = {f0:String}');
    expect(params.f0).toBe('mobile');
  });

  it('applies multiple filters', () => {
    const { sql, params } = buildAnalyticsQuery({
      ...baseQuery,
      filters: [
        { dimension: 'device', operator: 'equals', values: ['mobile'] },
        { dimension: 'utm_source', operator: 'in', values: ['google', 'facebook'] },
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
      metrics: ['avg_duration', 'sessions'],
    });
    expect(sql).toContain('ORDER BY avg_duration DESC');
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

    // median_duration uses: round(median(duration), 1)
    expect(sql).toContain('round(median(duration), 1) as value');
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
      filters: [{ dimension: 'device', operator: 'equals', values: ['mobile'] }],
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
});
