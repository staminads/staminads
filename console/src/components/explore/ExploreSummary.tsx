import { Statistic, Skeleton, Popover, Divider } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons'
import type { ExploreTotals } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'
import { formatNumber } from '../../lib/chart-utils'
import { getHeatMapColor, getDimensionLabel } from '../../lib/explore-utils'

interface ExploreSummaryProps {
  totals?: ExploreTotals
  showComparison: boolean
  loading?: boolean
  bestTimeScore?: number
  maxMedianDuration?: number
  timescoreReference?: number
  maxDimensionValues?: Record<string, string | number | null>
  customDimensionLabels?: CustomDimensionLabels | null
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

interface ChangeIndicatorProps {
  value?: number
  invertColors?: boolean
  showComparison: boolean
}

function ChangeIndicator({ value, invertColors = false, showComparison }: ChangeIndicatorProps) {
  if (!showComparison || value === undefined || value === null) return null

  const isPositive = value > 0
  const isNegative = value < 0

  // For metrics where lower is better (e.g., bounce rate), invert the colors
  const positiveColor = invertColors ? '#f97316' : '#16a34a'
  const negativeColor = invertColors ? '#16a34a' : '#f97316'
  const color = isPositive ? positiveColor : isNegative ? negativeColor : '#9ca3af'

  return (
    <span style={{ color, fontSize: 12, marginLeft: 8, display: 'inline-flex', alignItems: 'center' }}>
      {isPositive ? (
        <ArrowUpOutlined style={{ fontSize: 10 }} />
      ) : isNegative ? (
        <ArrowDownOutlined style={{ fontSize: 10 }} />
      ) : (
        <MinusOutlined style={{ fontSize: 10 }} />
      )}
      <span style={{ marginLeft: 2 }}>{Math.abs(value).toFixed(1)}%</span>
    </span>
  )
}

export function ExploreSummary({
  totals,
  showComparison,
  loading,
  bestTimeScore,
  maxMedianDuration,
  timescoreReference,
  maxDimensionValues,
  customDimensionLabels,
}: ExploreSummaryProps) {
  if (loading || !totals) {
    return (
      <div className="bg-white rounded-md px-6 py-4 mb-6">
        <div className="flex justify-between">
          <Skeleton.Input active size="small" style={{ width: 100 }} />
          <Skeleton.Input active size="small" style={{ width: 100 }} />
          <Skeleton.Input active size="small" style={{ width: 100 }} />
          <Skeleton.Input active size="small" style={{ width: 100 }} />
        </div>
      </div>
    )
  }

  const timescoreHeatColor = getHeatMapColor(
    totals.median_duration,
    maxMedianDuration ?? totals.median_duration,
    timescoreReference
  )

  const valueStyle = { fontSize: 20 }

  return (
    <div className="bg-white rounded-md px-6 py-4 mb-6">
      <div className="flex justify-between items-center">
        <Statistic
          title="Sessions"
          value={formatNumber(totals.sessions)}
          valueStyle={valueStyle}
          suffix={
            <ChangeIndicator
              value={totals.sessions_change}
              showComparison={showComparison}
            />
          }
        />

        <Divider type="vertical" style={{ height: 40 }} />

        <Statistic
          title="Median TimeScore"
          value={formatDuration(totals.median_duration)}
          valueStyle={valueStyle}
          prefix={
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: timescoreHeatColor,
                marginRight: 6,
              }}
            />
          }
          suffix={
            <ChangeIndicator
              value={totals.median_duration_change}
              showComparison={showComparison}
            />
          }
        />

        {bestTimeScore !== undefined && bestTimeScore > 0 && (
          <Divider type="vertical" style={{ height: 40 }} />
        )}

        {bestTimeScore !== undefined && bestTimeScore > 0 && (
          <Popover
            content={
              <div className="text-sm">
                <div className="font-medium mb-2">Best performing combination:</div>
                {maxDimensionValues && Object.keys(maxDimensionValues).length > 0 ? (
                  <div className="space-y-1">
                    {Object.entries(maxDimensionValues).map(([dim, value]) => (
                      <div key={dim} className="flex gap-2">
                        <span className="text-gray-500">{getDimensionLabel(dim, customDimensionLabels)}:</span>
                        <span className="font-medium">
                          {value === null || value === '' ? '(not set)' : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-500">No dimension data available</div>
                )}
              </div>
            }
            title={null}
            trigger="hover"
          >
            <div style={{ cursor: 'pointer' }}>
              <Statistic
                title="Best TimeScore"
                value={formatDuration(bestTimeScore)}
                valueStyle={valueStyle}
                prefix={
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: getHeatMapColor(
                        bestTimeScore,
                        maxMedianDuration ?? bestTimeScore,
                        timescoreReference
                      ),
                      marginRight: 6,
                    }}
                  />
                }
              />
            </div>
          </Popover>
        )}

        <Divider type="vertical" style={{ height: 40 }} />

        <Statistic
          title="Bounce Rate"
          value={totals.bounce_rate.toFixed(1)}
          valueStyle={valueStyle}
          suffix={
            <>
              %
              <ChangeIndicator
                value={totals.bounce_rate_change}
                invertColors
                showComparison={showComparison}
              />
            </>
          }
        />

        <Divider type="vertical" style={{ height: 40 }} />

        <Statistic
          title="Avg. Scroll"
          value={totals.max_scroll.toFixed(1)}
          valueStyle={valueStyle}
          suffix={
            <>
              %
              <ChangeIndicator
                value={totals.max_scroll_change}
                showComparison={showComparison}
              />
            </>
          }
        />
      </div>
    </div>
  )
}
