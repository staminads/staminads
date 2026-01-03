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
  'last_30_minutes',
  'today',
  'yesterday',
  'last_7_days',
  'last_14_days',
  'last_28_days',
  'last_30_days',
  'last_90_days',
  'last_91_days',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_12_months',
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

export interface AnalyticsQuery {
  workspace_id: string
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
