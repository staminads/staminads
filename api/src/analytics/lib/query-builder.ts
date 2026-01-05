import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ExtremesQueryDto } from '../dto/extremes-query.dto';
import { METRICS, getMetricSql, MetricContext } from '../constants/metrics';
import { DIMENSIONS } from '../constants/dimensions';
import { buildFilters } from './filter-builder';

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

// Granularity SQL generators - accept optional timezone for correct user-local grouping
const GRANULARITY_SQL: Record<
  string,
  { expr: (tz?: string) => string; column: string }
> = {
  hour: {
    expr: (tz) =>
      tz ? `toStartOfHour(created_at, '${tz}')` : 'toStartOfHour(created_at)',
    column: 'date_hour',
  },
  day: {
    expr: (tz) => (tz ? `toDate(created_at, '${tz}')` : 'toDate(created_at)'),
    column: 'date_day',
  },
  week: {
    expr: (tz) =>
      tz
        ? `toStartOfWeek(created_at, 1, '${tz}')`
        : 'toStartOfWeek(created_at, 1)',
    column: 'date_week',
  },
  month: {
    expr: (tz) =>
      tz ? `toStartOfMonth(created_at, '${tz}')` : 'toStartOfMonth(created_at)',
    column: 'date_month',
  },
  year: {
    expr: (tz) =>
      tz ? `toStartOfYear(created_at, '${tz}')` : 'toStartOfYear(created_at)',
    column: 'date_year',
  },
};

export function buildAnalyticsQuery(
  query: AnalyticsQueryDto,
  timezone?: string,
  metricContext?: MetricContext,
): BuiltQuery {
  // Validate and build metrics SQL
  const metricsSql = query.metrics.map((m) => {
    const metric = METRICS[m];
    if (!metric) throw new Error(`Unknown metric: ${m}`);
    const sql = metricContext
      ? getMetricSql(metric, metricContext)
      : metric.sql;
    return `${sql} as ${m}`;
  });

  // Validate and get dimension columns
  const dimensionCols = (query.dimensions || []).map((d) => {
    const dim = DIMENSIONS[d];
    if (!dim) throw new Error(`Unknown dimension: ${d}`);
    return dim.column;
  });

  // Handle granularity with optional timezone for user-local grouping
  const granularity = query.dateRange.granularity;
  let granularitySelect = '';
  let granularityColumn = '';
  if (granularity) {
    const g = GRANULARITY_SQL[granularity];
    // Apply timezone to granularity grouping (not filtering) for non-UTC users
    const tz = timezone && timezone !== 'UTC' ? timezone : undefined;
    granularitySelect = `${g.expr(tz)} as ${g.column}`;
    granularityColumn = g.column;
  }

  // Build filters
  const { sql: filterSql, params: filterParams } = buildFilters(
    query.filters || [],
  );

  // Build GROUP BY (granularity first, then dimensions)
  const groupByCols = [
    ...(granularityColumn ? [granularityColumn] : []),
    ...dimensionCols,
  ];
  const groupByClause =
    groupByCols.length > 0 ? `GROUP BY ${groupByCols.join(', ')}` : '';

  // Build HAVING clause (only if GROUP BY exists)
  const havingClause =
    query.havingMinSessions && groupByCols.length > 0
      ? `HAVING count() >= ${query.havingMinSessions}`
      : '';

  // Build ORDER BY
  let orderBy = '';
  if (granularityColumn) {
    // Always order by granularity first (ascending) when present
    const additionalOrder = query.order
      ? Object.entries(query.order)
          .map(([field, dir]) => {
            if (METRICS[field]) return `${field} ${dir.toUpperCase()}`;
            if (DIMENSIONS[field])
              return `${DIMENSIONS[field].column} ${dir.toUpperCase()}`;
            throw new Error(`Unknown order field: ${field}`);
          })
          .join(', ')
      : '';
    orderBy = `ORDER BY ${granularityColumn} ASC${additionalOrder ? ', ' + additionalOrder : ''}`;
  } else if (query.order) {
    const orderClauses = Object.entries(query.order).map(([field, dir]) => {
      if (METRICS[field]) return `${field} ${dir.toUpperCase()}`;
      if (DIMENSIONS[field])
        return `${DIMENSIONS[field].column} ${dir.toUpperCase()}`;
      throw new Error(`Unknown order field: ${field}`);
    });
    orderBy = `ORDER BY ${orderClauses.join(', ')}`;
  } else if (query.metrics.length > 0) {
    orderBy = `ORDER BY ${query.metrics[0]} DESC`;
  }

  // Build SELECT clause
  const selectParts = [
    ...(granularitySelect ? [granularitySelect] : []),
    ...dimensionCols,
    ...metricsSql,
  ];
  const selectClause = selectParts.join(',\n  ');
  const limitClause = `LIMIT ${Math.min(query.limit || 1000, 10000)}`;

  // Note: workspace_id filter removed since each workspace has its own database
  const whereConditions = [
    'created_at >= toDateTime64({date_start:String}, 3)',
    'created_at <= toDateTime64({date_end:String}, 3)',
  ];
  if (filterSql) {
    whereConditions.push(filterSql);
  }

  const sql = `
SELECT
  ${selectClause}
FROM sessions FINAL
WHERE ${whereConditions.join('\n  AND ')}
${groupByClause}
${havingClause}
${orderBy}
${limitClause}
  `.trim();

  const params: Record<string, unknown> = {
    date_start: query.dateRange.start,
    date_end: query.dateRange.end,
    ...filterParams,
  };

  return { sql, params };
}

export function buildExtremesQuery(
  query: ExtremesQueryDto & { dateRange: { start?: string; end?: string } },
  metricContext?: MetricContext,
): BuiltQuery {
  const metric = METRICS[query.metric];
  if (!metric) throw new Error(`Unknown metric: ${query.metric}`);
  const metricSql = metricContext
    ? getMetricSql(metric, metricContext)
    : metric.sql;

  // Validate and get dimension columns
  const groupByCols = query.groupBy.map((d) => {
    const dim = DIMENSIONS[d];
    if (!dim) throw new Error(`Unknown dimension: ${d}`);
    return dim.column;
  });

  // Build filters
  const { sql: filterSql, params: filterParams } = buildFilters(
    query.filters || [],
  );

  // WHERE conditions
  const whereConditions = [
    'created_at >= toDateTime64({date_start:String}, 3)',
    'created_at <= toDateTime64({date_end:String}, 3)',
  ];
  if (filterSql) {
    whereConditions.push(filterSql);
  }

  // HAVING clause (for minimum sessions filter)
  const havingClause = query.havingMinSessions
    ? `HAVING count() >= ${query.havingMinSessions}`
    : '';

  // Build dimension select list for returning winning values
  const dimensionSelectList = groupByCols.join(', ');

  // Two-stage query: find extremes AND the dimension values that achieved them
  // Use subqueries instead of CTEs to avoid ClickHouse database prefix issues
  const sql = `
SELECT
  sub.min as min,
  sub.max as max,
  max_row.${groupByCols.join(', max_row.')}
FROM (
  SELECT min(value) as min, max(value) as max
  FROM (
    SELECT ${metricSql} as value
    FROM sessions FINAL
    WHERE ${whereConditions.join('\n      AND ')}
    GROUP BY ${dimensionSelectList}
    ${havingClause}
  ) grouped
) sub
LEFT JOIN (
  SELECT ${dimensionSelectList}, ${metricSql} as value
  FROM sessions FINAL
  WHERE ${whereConditions.join('\n    AND ')}
  GROUP BY ${dimensionSelectList}
  ${havingClause}
) max_row ON max_row.value = sub.max
LIMIT 1`.trim();

  const params: Record<string, unknown> = {
    date_start: query.dateRange.start,
    date_end: query.dateRange.end,
    ...filterParams,
  };

  return { sql, params };
}
