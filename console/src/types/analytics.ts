export const FILTER_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'contains',
  'notContains',
  'gt',
  'gte',
  'lt',
  'lte',
  'isNull',
  'isNotNull',
  'between',
  'isEmpty',
  'isNotEmpty',
] as const

export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export const GRANULARITIES = ['hour', 'day', 'week', 'month', 'year'] as const
export type Granularity = (typeof GRANULARITIES)[number]

export const DATE_PRESETS = [
  'previous_30_minutes',
  'today',
  'yesterday',
  'previous_7_days',
  'previous_14_days',
  'previous_28_days',
  'previous_30_days',
  'previous_90_days',
  'previous_91_days',
  'this_week',
  'previous_week',
  'this_month',
  'previous_month',
  'this_quarter',
  'previous_quarter',
  'this_year',
  'previous_year',
  'previous_12_months',
  'all_time',
  'custom',
] as const

export type DatePreset = (typeof DATE_PRESETS)[number]

export interface Filter {
  dimension: string
  operator: FilterOperator
  values?: (string | number | null)[]
}

export interface DateRange {
  start?: string
  end?: string
  preset?: DatePreset
  granularity?: Granularity
}

export type AnalyticsTable = 'sessions' | 'pages' | 'goals'

export interface AnalyticsQuery {
  workspace_id: string
  table?: AnalyticsTable
  metrics: string[]
  dimensions?: string[]
  filters?: Filter[]
  dateRange: DateRange
  compareDateRange?: DateRange
  timezone?: string
  order?: Record<string, 'asc' | 'desc'>
  limit?: number
  havingMinSessions?: number
}

export interface AnalyticsResponse {
  data: Record<string, unknown>[] | { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
  meta: {
    metrics: string[]
    dimensions: string[]
    granularity?: string
    dateRange: { start: string; end: string }
    compareDateRange?: { start: string; end: string }
    total_rows: number
  }
  query: {
    sql: string
    params: Record<string, unknown>
  }
}

export interface MetricDefinition {
  name: string
  description: string
}

export interface DimensionDefinition {
  name: string
  type: 'string' | 'number' | 'boolean'
  category: string
}

export interface ExtremesQuery {
  workspace_id: string
  metric: string
  groupBy: string[]
  dateRange: DateRange
  filters?: Filter[]
  timezone?: string
  havingMinSessions?: number
}

export interface ExtremesResponse {
  min: number | null
  max: number | null
  maxDimensionValues?: Record<string, string | number | null>
  meta: {
    metric: string
    groupBy: string[]
    dateRange: { start: string; end: string }
  }
}
