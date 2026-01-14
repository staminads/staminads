import { FilterDto, MetricFilterDto } from '../dto/analytics-query.dto';
import { DIMENSIONS } from '../constants/dimensions';
import { METRICS, getMetricSql, MetricContext } from '../constants/metrics';
import { AnalyticsTable } from '../constants/tables';

export interface FilterResult {
  sql: string;
  params: Record<string, unknown>;
}

export function buildFilters(
  filters: FilterDto[],
  paramPrefix = 'f',
  table: AnalyticsTable = 'sessions',
): FilterResult {
  if (!filters || filters.length === 0) {
    return { sql: '', params: {} };
  }

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  let paramIndex = 0;

  for (const filter of filters) {
    const dimension = DIMENSIONS[filter.dimension];
    if (!dimension) {
      throw new Error(`Unknown dimension: ${filter.dimension}`);
    }
    if (!dimension.tables.includes(table)) {
      throw new Error(
        `Dimension '${filter.dimension}' is not available for table '${table}'`,
      );
    }

    const col = dimension.column;
    const paramName = `${paramPrefix}${paramIndex++}`;

    switch (filter.operator) {
      case 'equals':
        conditions.push(`${col} = {${paramName}:String}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'notEquals':
        conditions.push(`${col} != {${paramName}:String}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'in':
        conditions.push(`${col} IN {${paramName}:Array(String)}`);
        params[paramName] = filter.values;
        break;
      case 'notIn':
        conditions.push(`${col} NOT IN {${paramName}:Array(String)}`);
        params[paramName] = filter.values;
        break;
      case 'contains':
        conditions.push(`${col} LIKE {${paramName}:String}`);
        params[paramName] = `%${filter.values?.[0]}%`;
        break;
      case 'notContains':
        conditions.push(`${col} NOT LIKE {${paramName}:String}`);
        params[paramName] = `%${filter.values?.[0]}%`;
        break;
      case 'gt':
        conditions.push(`${col} > {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'gte':
        conditions.push(`${col} >= {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'lt':
        conditions.push(`${col} < {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'lte':
        conditions.push(`${col} <= {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'isNull':
        conditions.push(`${col} IS NULL`);
        break;
      case 'isNotNull':
        conditions.push(`${col} IS NOT NULL`);
        break;
      case 'isEmpty':
        conditions.push(`(${col} = '' OR ${col} IS NULL)`);
        break;
      case 'isNotEmpty':
        conditions.push(`(${col} != '' AND ${col} IS NOT NULL)`);
        break;
      case 'between': {
        const p1 = `${paramName}a`;
        const p2 = `${paramName}b`;
        conditions.push(`${col} BETWEEN {${p1}:Float64} AND {${p2}:Float64}`);
        params[p1] = filter.values?.[0];
        params[p2] = filter.values?.[1];
        break;
      }
    }
  }

  return {
    sql: conditions.join(' AND '),
    params,
  };
}

export function buildMetricFilters(
  metricFilters: MetricFilterDto[],
  table: AnalyticsTable,
  ctx: MetricContext,
  paramPrefix = 'mf',
): FilterResult {
  if (!metricFilters || metricFilters.length === 0) {
    return { sql: '', params: {} };
  }

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  let paramIndex = 0;

  for (const filter of metricFilters) {
    const metric = METRICS[filter.metric];
    if (!metric) {
      throw new Error(`Unknown metric: ${filter.metric}`);
    }
    if (!metric.tables.includes(table)) {
      throw new Error(
        `Metric '${filter.metric}' is not available for table '${table}'`,
      );
    }

    const metricSql = getMetricSql(metric, ctx);
    const paramName = `${paramPrefix}${paramIndex++}`;

    switch (filter.operator) {
      case 'gt':
        conditions.push(`${metricSql} > {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'gte':
        conditions.push(`${metricSql} >= {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'lt':
        conditions.push(`${metricSql} < {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'lte':
        conditions.push(`${metricSql} <= {${paramName}:Float64}`);
        params[paramName] = filter.values?.[0];
        break;
      case 'between': {
        const p1 = `${paramName}a`;
        const p2 = `${paramName}b`;
        conditions.push(
          `${metricSql} BETWEEN {${p1}:Float64} AND {${p2}:Float64}`,
        );
        params[p1] = filter.values?.[0];
        params[p2] = filter.values?.[1];
        break;
      }
    }
  }

  return {
    sql: conditions.join(' AND '),
    params,
  };
}
