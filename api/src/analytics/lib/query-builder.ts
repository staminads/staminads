import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ExtremesQueryDto } from '../dto/extremes-query.dto';
import { METRICS, getMetricSql, MetricContext } from '../constants/metrics';
import { DIMENSIONS } from '../constants/dimensions';
import { TABLE_CONFIGS, AnalyticsTable } from '../constants/tables';
import { buildFilters } from './filter-builder';

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

// Granularity SQL generators - accept date column and optional timezone for correct user-local grouping
const GRANULARITY_SQL: Record<
  string,
  { expr: (dateCol: string, tz?: string) => string; column: string }
> = {
  hour: {
    expr: (dateCol, tz) =>
      tz ? `toStartOfHour(${dateCol}, '${tz}')` : `toStartOfHour(${dateCol})`,
    column: 'date_hour',
  },
  day: {
    expr: (dateCol, tz) =>
      tz ? `toDate(${dateCol}, '${tz}')` : `toDate(${dateCol})`,
    column: 'date_day',
  },
  week: {
    expr: (dateCol, tz) =>
      tz
        ? `toStartOfWeek(${dateCol}, 1, '${tz}')`
        : `toStartOfWeek(${dateCol}, 1)`,
    column: 'date_week',
  },
  month: {
    expr: (dateCol, tz) =>
      tz ? `toStartOfMonth(${dateCol}, '${tz}')` : `toStartOfMonth(${dateCol})`,
    column: 'date_month',
  },
  year: {
    expr: (dateCol, tz) =>
      tz ? `toStartOfYear(${dateCol}, '${tz}')` : `toStartOfYear(${dateCol})`,
    column: 'date_year',
  },
};

export function buildAnalyticsQuery(
  query: AnalyticsQueryDto,
  timezone?: string,
  metricContext?: MetricContext,
): BuiltQuery {
  // Get table configuration (default to sessions for backward compatibility)
  const table: AnalyticsTable = query.table || 'sessions';
  const tableConfig = TABLE_CONFIGS[table];

  // Validate and build metrics SQL
  // Default context for metrics that require it (e.g., bounce_rate)
  const defaultContext: MetricContext = { bounce_threshold: 10 };
  const ctx = metricContext ?? defaultContext;
  const metricsSql = query.metrics.map((m) => {
    const metric = METRICS[m];
    if (!metric) throw new Error(`Unknown metric: ${m}`);
    if (!metric.tables.includes(table)) {
      throw new Error(`Metric '${m}' is not available for table '${table}'`);
    }
    const sql = getMetricSql(metric, ctx);
    return `${sql} as ${m}`;
  });

  // Validate and get dimension columns
  const dimensionCols = (query.dimensions || []).map((d) => {
    const dim = DIMENSIONS[d];
    if (!dim) throw new Error(`Unknown dimension: ${d}`);
    if (!dim.tables.includes(table)) {
      throw new Error(`Dimension '${d}' is not available for table '${table}'`);
    }
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
    granularitySelect = `${g.expr(tableConfig.dateColumn, tz)} as ${g.column}`;
    granularityColumn = g.column;
  }

  // Build filters
  const { sql: filterSql, params: filterParams } = buildFilters(
    query.filters || [],
    'f',
    table,
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
  // Explicitly use UTC to ensure correct filtering regardless of ClickHouse server timezone
  const dateCol = tableConfig.dateColumn;
  const whereConditions = [
    `${dateCol} >= toDateTime64({date_start:String}, 3, 'UTC')`,
    `${dateCol} <= toDateTime64({date_end:String}, 3, 'UTC')`,
  ];
  if (filterSql) {
    whereConditions.push(filterSql);
  }

  // Build FROM clause with optional FINAL modifier (ReplacingMergeTree tables need FINAL)
  const fromClause = `FROM ${table}${tableConfig.finalModifier ? ' FINAL' : ''}`;

  const sql = `
SELECT
  ${selectClause}
${fromClause}
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
  // Get table configuration (default to sessions for backward compatibility)
  const table: AnalyticsTable = query.table || 'sessions';
  const tableConfig = TABLE_CONFIGS[table];

  const metric = METRICS[query.metric];
  if (!metric) throw new Error(`Unknown metric: ${query.metric}`);
  if (!metric.tables.includes(table)) {
    throw new Error(
      `Metric '${query.metric}' is not available for table '${table}'`,
    );
  }
  // Default context for metrics that require it (e.g., bounce_rate)
  const defaultContext: MetricContext = { bounce_threshold: 10 };
  const ctx = metricContext ?? defaultContext;
  const metricSql = getMetricSql(metric, ctx);

  // Validate and get dimension columns
  const groupByCols = query.groupBy.map((d) => {
    const dim = DIMENSIONS[d];
    if (!dim) throw new Error(`Unknown dimension: ${d}`);
    if (!dim.tables.includes(table)) {
      throw new Error(`Dimension '${d}' is not available for table '${table}'`);
    }
    return dim.column;
  });

  // Build filters
  const { sql: filterSql, params: filterParams } = buildFilters(
    query.filters || [],
    'f',
    table,
  );

  // WHERE conditions
  // Explicitly use UTC to ensure correct filtering regardless of ClickHouse server timezone
  const dateCol = tableConfig.dateColumn;
  const whereConditions = [
    `${dateCol} >= toDateTime64({date_start:String}, 3, 'UTC')`,
    `${dateCol} <= toDateTime64({date_end:String}, 3, 'UTC')`,
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

  // Build FROM clause with optional FINAL modifier
  const fromClause = `${table}${tableConfig.finalModifier ? ' FINAL' : ''}`;

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
    FROM ${fromClause}
    WHERE ${whereConditions.join('\n      AND ')}
    GROUP BY ${dimensionSelectList}
    ${havingClause}
  ) grouped
) sub
LEFT JOIN (
  SELECT ${dimensionSelectList}, ${metricSql} as value
  FROM ${fromClause}
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
