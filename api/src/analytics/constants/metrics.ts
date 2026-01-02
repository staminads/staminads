export interface MetricContext {
  bounce_threshold: number;
}

export interface MetricDefinition {
  name: string;
  sql: string | ((ctx: MetricContext) => string);
  description: string;
}

export function getMetricSql(
  metric: MetricDefinition,
  ctx: MetricContext,
): string {
  return typeof metric.sql === 'function' ? metric.sql(ctx) : metric.sql;
}

export const METRICS: Record<string, MetricDefinition> = {
  sessions: {
    name: 'sessions',
    sql: 'count()',
    description: 'Total sessions',
  },
  avg_duration: {
    name: 'avg_duration',
    sql: 'round(avg(duration), 1)',
    description: 'Average session duration in seconds',
  },
  median_duration: {
    name: 'median_duration',
    sql: 'round(median(duration), 1)',
    description: 'Median session duration in seconds',
  },
  max_scroll: {
    name: 'max_scroll',
    sql: 'round(avg(max_scroll), 1)',
    description: 'Average max scroll depth (%)',
  },
  bounce_rate: {
    name: 'bounce_rate',
    sql: (ctx: MetricContext) =>
      `round(countIf(duration < ${ctx.bounce_threshold}) * 100.0 / count(), 2)`,
    description: 'Percentage of sessions under bounce threshold',
  },
};
