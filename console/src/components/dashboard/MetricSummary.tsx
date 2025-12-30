import { Statistic, Skeleton } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { formatValue } from '../../lib/chart-utils'
import { METRICS, type DashboardData, type MetricKey } from '../../types/dashboard'

interface MetricSummaryProps {
  data: DashboardData | null
  loading?: boolean
  selectedMetric: MetricKey
  onMetricSelect: (metric: MetricKey) => void
  showComparison?: boolean
}

export function MetricSummary({
  data,
  loading = false,
  selectedMetric,
  onMetricSelect,
  showComparison = true,
}: MetricSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4">
      {METRICS.map((metric, index) => {
        const metricData = data?.metrics[metric.key]
        const currentTotal = metricData?.currentTotal ?? 0
        const changePercent = metricData?.changePercent ?? 0
        const isSelected = selectedMetric === metric.key
        const isLast = index === METRICS.length - 1

        // For inverted metrics (like bounce_rate), negative change is good
        const isPositive = metric.invertTrend
          ? changePercent <= 0
          : changePercent >= 0

        return (
          <div
            key={metric.key}
            onClick={() => onMetricSelect(metric.key)}
            className={`
              cursor-pointer p-4 transition-colors
              ${!isLast ? 'border-r border-gray-200' : ''}
              ${isSelected ? 'border-b-2 border-b-[var(--primary)]' : 'border-b border-b-gray-200 hover:bg-gray-50'}
            `}
          >
            {loading ? (
              <Skeleton active paragraph={false} title={{ width: '60%' }} />
            ) : (
              <>
                <div className="text-xs text-gray-500 mb-1">{metric.label}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-gray-800">
                    {formatValue(currentTotal, metric.format)}
                  </span>
                  {showComparison && changePercent !== 0 && (
                    <Statistic
                      value={Math.abs(changePercent)}
                      precision={1}
                      valueStyle={{
                        fontSize: '12px',
                        color: isPositive ? '#10b981' : '#ef4444',
                        fontWeight: 500,
                      }}
                      prefix={
                        changePercent >= 0 ? (
                          <ArrowUpOutlined style={{ fontSize: '10px' }} />
                        ) : (
                          <ArrowDownOutlined style={{ fontSize: '10px' }} />
                        )
                      }
                      suffix="%"
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
