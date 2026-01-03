import type { DatePreset, Granularity, AnalyticsResponse } from './analytics'

export type ComparisonMode = 'previous_period' | 'previous_year' | 'none'

export interface WorkspaceSearch {
  // Shared params (dashboard + explore)
  period?: DatePreset
  timezone?: string
  comparison?: ComparisonMode
  customStart?: string
  customEnd?: string
  // Explore-specific params
  dimensions?: string // Comma-separated dimension list
  filters?: string // JSON-encoded Filter[]
  minSessions?: string // Stored as string in URL, parsed to number
}

export type MetricKey = 'sessions' | 'median_duration' | 'bounce_rate' | 'max_scroll'

export interface MetricConfig {
  key: MetricKey
  label: string
  format: 'number' | 'duration' | 'percentage'
  color: string
  previousColor: string
  invertTrend?: boolean // For metrics like bounce_rate where lower is better
  tooltip?: string
}

export interface ChartDataPoint {
  timestamp: string
  value: number
}

export interface MetricData {
  current: ChartDataPoint[]
  previous: ChartDataPoint[]
  currentTotal: number
  previousTotal: number
  changePercent: number
}

export interface DashboardData {
  metrics: Record<string, MetricData>
  dateRange: { start: string; end: string }
  compareDateRange: { start: string; end: string }
  granularity: Granularity
}

export const METRICS: MetricConfig[] = [
  {
    key: 'sessions',
    label: 'Sessions',
    format: 'number',
    color: '#7763f1',
    previousColor: '#9ca3af',
  },
  {
    key: 'median_duration',
    label: 'Median TimeScore',
    format: 'duration',
    color: '#10b981',
    previousColor: '#9ca3af',
    tooltip: 'TimeScore is the median session duration across all sessions',
  },
  {
    key: 'bounce_rate',
    label: 'Bounce Rate',
    format: 'percentage',
    color: '#f59e0b',
    previousColor: '#9ca3af',
    invertTrend: true, // Lower bounce rate is better
  },
  {
    key: 'max_scroll',
    label: 'Avg. Scroll Depth',
    format: 'percentage',
    color: '#3b82f6',
    previousColor: '#9ca3af',
  },
]

export const PERIOD_LABELS: Record<DatePreset, string> = {
  last_30_minutes: 'Last 30 Minutes',
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 Days',
  last_14_days: 'Last 14 Days',
  last_28_days: 'Last 28 Days',
  last_30_days: 'Last 30 Days',
  last_90_days: 'Last 90 Days',
  last_91_days: 'Last 91 Days',
  this_week: 'This Week',
  last_week: 'Last Week',
  this_month: 'Month to Date',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_year: 'Year to Date',
  last_year: 'Last Year',
  last_12_months: 'Last 12 Months',
  all_time: 'All time',
  custom: 'Custom Range',
}

export const PRESET_GROUPS: DatePreset[][] = [
  ['today', 'yesterday'],
  ['last_7_days', 'last_28_days', 'last_91_days'],
  ['this_month', 'last_month'],
  ['this_year', 'last_12_months'],
  ['all_time', 'custom'],
]

// Helper to extract dashboard data from API response
export function extractDashboardData(
  response: AnalyticsResponse,
  granularity: Granularity,
): DashboardData {
  const data = response.data as { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
  const dateColumn = getDateColumn(granularity)

  const metrics: Record<string, MetricData> = {}

  for (const metric of METRICS) {
    const currentData = data.current.map((row) => ({
      timestamp: String(row[dateColumn]),
      value: Number(row[metric.key] ?? 0),
    }))

    const previousData = data.previous.map((row) => ({
      timestamp: String(row[dateColumn]),
      value: Number(row[metric.key] ?? 0),
    }))

    const currentTotal = currentData.reduce((sum, d) => sum + d.value, 0)
    const previousTotal = previousData.reduce((sum, d) => sum + d.value, 0)

    // For avg metrics, calculate average instead of sum
    const isAvgMetric = ['median_duration', 'bounce_rate', 'max_scroll'].includes(metric.key)
    const finalCurrentTotal = isAvgMetric && currentData.length > 0
      ? currentTotal / currentData.length
      : currentTotal
    const finalPreviousTotal = isAvgMetric && previousData.length > 0
      ? previousTotal / previousData.length
      : previousTotal

    const changePercent = finalPreviousTotal !== 0
      ? ((finalCurrentTotal - finalPreviousTotal) / finalPreviousTotal) * 100
      : 0

    metrics[metric.key] = {
      current: currentData,
      previous: previousData,
      currentTotal: finalCurrentTotal,
      previousTotal: finalPreviousTotal,
      changePercent,
    }
  }

  return {
    metrics,
    dateRange: response.meta.dateRange,
    compareDateRange: response.meta.compareDateRange!,
    granularity,
  }
}

function getDateColumn(granularity: Granularity): string {
  const columns: Record<Granularity, string> = {
    hour: 'date_hour',
    day: 'date_day',
    week: 'date_week',
    month: 'date_month',
    year: 'date_year',
  }
  return columns[granularity]
}
