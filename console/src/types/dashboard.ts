import type { ReactNode } from 'react'
import type { DatePreset, DateRange, Filter, Granularity, AnalyticsResponse } from './analytics'

export type ComparisonMode = 'previous_period' | 'previous_year' | 'none'

// ============================================
// Dimension Table Widget Types
// ============================================

/** Tab configuration for DimensionTableWidget - defines what data to fetch */
export interface DimensionTabConfig {
  /** Unique key for the tab */
  key: string
  /** Tab button label (e.g., "Devices", "Browsers") */
  label: string
  /** Column header for dimension column (e.g., "Device", "Page") */
  dimensionLabel: string
  /** API dimension field to query (e.g., "device", "landing_path") */
  dimension: string
  /** Response field name if different from dimension (e.g., "referrer_domain") */
  dimensionField?: string
  /** Metrics to fetch (default: ['sessions', 'median_duration']) */
  metrics?: string[]
  /** Widget-specific filters (combined with global filters) */
  filters?: Filter[]
  /** Sort order (default: { sessions: 'desc' }) */
  order?: Record<string, 'asc' | 'desc'>
  /** Max rows to fetch (default: 10) */
  limit?: number
  /** Tab render type: 'table' (default) or 'country_map' for map visualization */
  type?: 'table' | 'country_map'
}

/** Dashboard context value passed to widgets via React Context */
export interface DashboardContextValue {
  workspaceId: string
  dateRange: DateRange
  compareDateRange?: DateRange
  timezone: string
  /** Global filters applied to all widgets */
  globalFilters: Filter[]
  showComparison: boolean
  timescoreReference: number
}

/** Standard data shape for all dimension widgets */
export interface DimensionData {
  dimension_value: string
  sessions: number
  median_duration: number
  prev_sessions?: number
  prev_median_duration?: number
}

/** Props for DimensionTableWidget */
export interface DimensionTableWidgetProps {
  /** Widget title */
  title: string
  /** Optional info tooltip next to title */
  infoTooltip?: string
  /** Tab configurations (at least one required) */
  tabs: DimensionTabConfig[]
  /** Optional icon renderer for dimension values */
  iconPrefix?: (value: string, tabKey: string) => ReactNode
  /** Optional row click handler */
  onRowClick?: (row: DimensionData, tabKey: string) => void
  /** Empty state message (default: "No data available") */
  emptyText?: string
}

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

export type MetricKey = 'sessions' | 'median_duration' | 'bounce_rate' | 'median_scroll'

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
    key: 'median_scroll',
    label: 'Median Scroll Depth',
    format: 'percentage',
    color: '#3b82f6',
    previousColor: '#9ca3af',
  },
]

export const PERIOD_LABELS: Record<DatePreset, string> = {
  previous_30_minutes: 'Previous 30 Minutes',
  today: 'Today',
  yesterday: 'Yesterday',
  previous_7_days: 'Previous 7 Days',
  previous_14_days: 'Previous 14 Days',
  previous_28_days: 'Previous 28 Days',
  previous_30_days: 'Previous 30 Days',
  previous_90_days: 'Previous 90 Days',
  previous_91_days: 'Previous 91 Days',
  this_week: 'This Week',
  previous_week: 'Previous Week',
  this_month: 'Month to Date',
  previous_month: 'Previous Month',
  this_quarter: 'This Quarter',
  previous_quarter: 'Previous Quarter',
  this_year: 'Year to Date',
  previous_year: 'Previous Year',
  previous_12_months: 'Previous 12 Months',
  all_time: 'All time',
  custom: 'Custom Range',
}

export const PRESET_GROUPS: DatePreset[][] = [
  ['today', 'yesterday'],
  ['previous_7_days', 'previous_28_days', 'previous_91_days'],
  ['this_month', 'previous_month'],
  ['this_year', 'previous_12_months'],
  ['all_time', 'custom'],
]

// Helper to extract dashboard data from API response
export function extractDashboardData(
  response: AnalyticsResponse,
  granularity: Granularity,
): DashboardData {
  const data = response.data as { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
  const expectedDateColumn = getDateColumn(granularity)

  // Find the actual date column in the data (handles keepPreviousData cache mismatch)
  const firstRow = data.current[0]
  const dateColumn = firstRow
    ? findDateColumn(firstRow, expectedDateColumn)
    : expectedDateColumn

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
    const isAvgMetric = ['median_duration', 'bounce_rate', 'median_scroll'].includes(metric.key)
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

// All possible date columns in priority order (most granular first)
const DATE_COLUMNS = ['date_hour', 'date_day', 'date_week', 'date_month', 'date_year']

/**
 * Find the actual date column in the row data.
 * This handles cases where cached data has a different granularity than expected.
 */
function findDateColumn(row: Record<string, unknown>, expected: string): string {
  // If expected column exists, use it
  if (row[expected] !== undefined) {
    return expected
  }
  // Otherwise, find the first available date column
  for (const col of DATE_COLUMNS) {
    if (row[col] !== undefined) {
      return col
    }
  }
  // Fallback to expected (will result in undefined timestamps, but won't crash)
  return expected
}
