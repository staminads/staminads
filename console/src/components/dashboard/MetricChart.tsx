import ReactECharts from 'echarts-for-react'
import { Empty } from 'antd'
import { createMetricChartOption, formatDateRange } from '../../lib/chart-utils'
import type { ChartDataPoint, MetricConfig } from '../../types/dashboard'
import type { Granularity } from '../../types/analytics'
import type { Annotation } from '../../types/workspace'

interface MetricChartProps {
  metric: MetricConfig
  currentData: ChartDataPoint[]
  previousData: ChartDataPoint[]
  granularity: Granularity
  dateRange: { start: string; end: string }
  compareDateRange: { start: string; end: string }
  loading?: boolean
  height?: number
  annotations?: Annotation[]
  timezone?: string
}

export function MetricChart({
  metric,
  currentData,
  previousData,
  granularity,
  dateRange,
  compareDateRange,
  loading = false,
  height = 180,
  annotations,
  timezone,
}: MetricChartProps) {
  if (loading) {
    return (
      <div
        className="animate-pulse bg-gray-100 rounded"
        style={{ height }}
      />
    )
  }

  if (currentData.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <Empty description="No data available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  const currentLabel = formatDateRange(dateRange.start, dateRange.end)
  const previousLabel = formatDateRange(compareDateRange.start, compareDateRange.end)

  const option = createMetricChartOption(
    metric,
    currentData,
    previousData,
    granularity,
    currentLabel,
    previousLabel,
    annotations,
    timezone,
  )

  return (
    <ReactECharts
      option={option}
      style={{ height }}
      opts={{ renderer: 'svg' }}
      notMerge
    />
  )
}
