import { AnalyticsTable } from './tables';

export interface MetricContext {
  bounce_threshold: number;
}

export interface MetricDefinition {
  name: string;
  sql: string | ((ctx: MetricContext) => string);
  description: string;
  tables: AnalyticsTable[];
}

export function getMetricSql(
  metric: MetricDefinition,
  ctx: MetricContext,
): string {
  return typeof metric.sql === 'function' ? metric.sql(ctx) : metric.sql;
}

export const METRICS: Record<string, MetricDefinition> = {
  // Session metrics
  sessions: {
    name: 'sessions',
    sql: 'count()',
    description: 'Total sessions',
    tables: ['sessions'],
  },
  avg_duration: {
    name: 'avg_duration',
    sql: 'round(avg(duration), 1)',
    description: 'Average session duration in seconds',
    tables: ['sessions'],
  },
  median_duration: {
    name: 'median_duration',
    sql: 'round(median(duration), 1)',
    description: 'Median session duration in seconds',
    tables: ['sessions'],
  },
  max_scroll: {
    name: 'max_scroll',
    sql: 'round(avg(max_scroll), 1)',
    description: 'Average max scroll depth (%)',
    tables: ['sessions'],
  },
  median_scroll: {
    name: 'median_scroll',
    sql: 'round(median(max_scroll), 1)',
    description: 'Median max scroll depth (%)',
    tables: ['sessions'],
  },
  bounce_rate: {
    name: 'bounce_rate',
    sql: (ctx: MetricContext) =>
      `round(countIf(duration < ${ctx.bounce_threshold}) * 100.0 / count(), 2)`,
    description: 'Percentage of sessions under bounce threshold',
    tables: ['sessions'],
  },
  // Session page metrics (aggregated from sessions table)
  pageviews: {
    name: 'pageviews',
    sql: "countIf(name = 'screen_view')",
    description: 'Total pageviews',
    tables: ['sessions'],
  },
  pages_per_session: {
    name: 'pages_per_session',
    sql: 'round(avg(pageview_count), 2)',
    description: 'Average pages per session',
    tables: ['sessions'],
  },
  median_page_duration: {
    name: 'median_page_duration',
    sql: 'round(median(median_page_duration), 1)',
    description: 'Median time on page (seconds)',
    tables: ['sessions'],
  },

  // Page table metrics (per-page analytics)
  page_count: {
    name: 'page_count',
    sql: 'count()',
    description: 'Total page views',
    tables: ['pages'],
  },
  unique_pages: {
    name: 'unique_pages',
    sql: 'uniqExact(path)',
    description: 'Unique page paths viewed',
    tables: ['pages'],
  },
  page_duration: {
    name: 'page_duration',
    sql: 'round(median(duration), 1)',
    description: 'Median time on page (seconds)',
    tables: ['pages'],
  },
  page_scroll: {
    name: 'page_scroll',
    sql: 'round(median(max_scroll), 1)',
    description: 'Median scroll depth (%)',
    tables: ['pages'],
  },
  landing_page_count: {
    name: 'landing_page_count',
    sql: 'countIf(is_landing = true)',
    description: 'Number of landing page views',
    tables: ['pages'],
  },
  exit_page_count: {
    name: 'exit_page_count',
    sql: 'countIf(is_exit = true)',
    description: 'Number of exit page views',
    tables: ['pages'],
  },
  exit_rate: {
    name: 'exit_rate',
    sql: 'round(countIf(is_exit = true) * 100.0 / count(), 2)',
    description: 'Percentage of views that are exit pages',
    tables: ['pages'],
  },
};
