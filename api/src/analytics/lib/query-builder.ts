import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { METRICS } from '../constants/metrics';
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
      tz
        ? `toStartOfMonth(created_at, '${tz}')`
        : 'toStartOfMonth(created_at)',
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
): BuiltQuery {
  // Validate and build metrics SQL
  const metricsSql = query.metrics.map((m) => {
    const metric = METRICS[m];
    if (!metric) throw new Error(`Unknown metric: ${m}`);
    return `${metric.sql} as ${m}`;
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

  const whereConditions = [
    'workspace_id = {workspace_id:String}',
    'created_at >= {date_start:DateTime64(3)}',
    'created_at <= {date_end:DateTime64(3)}',
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
${orderBy}
${limitClause}
  `.trim();

  const params: Record<string, unknown> = {
    workspace_id: query.workspace_id,
    date_start: query.dateRange.start,
    date_end: query.dateRange.end,
    ...filterParams,
  };

  return { sql, params };
}
