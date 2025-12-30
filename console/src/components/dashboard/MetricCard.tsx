import { Card } from 'antd'
import { MetricChart } from './MetricChart'
import type { MetricConfig, MetricData } from '../../types/dashboard'
import type { Granularity } from '../../types/analytics'

interface MetricCardProps {
  metric: MetricConfig
  data: MetricData | undefined
  granularity: Granularity
  dateRange: { start: string; end: string }
  compareDateRange: { start: string; end: string }
  loading?: boolean
  height?: number
  showComparison?: boolean
}

export function MetricCard({
  metric,
  data,
  granularity,
  dateRange,
  compareDateRange,
  loading = false,
  height = 180,
  showComparison = true,
}: MetricCardProps) {
  return (
    <Card
      className="shadow-sm h-full"
      styles={{ body: { padding: '16px' } }}
    >
      <div className="text-sm font-medium text-gray-600 mb-3">{metric.label}</div>
      <MetricChart
        metric={metric}
        currentData={data?.current ?? []}
        previousData={showComparison ? (data?.previous ?? []) : []}
        granularity={granularity}
        dateRange={dateRange}
        compareDateRange={compareDateRange}
        loading={loading}
        height={height}
      />
    </Card>
  )
}
