import { Statistic, Skeleton, Popover, Divider } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons'
import type { ExploreTotals } from '../../types/explore'
import type { CustomDimensionLabels, Annotation } from '../../types/workspace'
import { formatNumber } from '../../lib/chart-utils'
import { getHeatMapColor, getDimensionLabel } from '../../lib/explore-utils'
import { DaysOfWeek } from '../../lib/dictionaries'

interface ExploreSummaryProps {
  totals?: ExploreTotals
  showComparison: boolean
  loading?: boolean
  bestTimeScore?: number
  maxMedianDuration?: number
  timescoreReference?: number
  maxDimensionValues?: Record<string, string | number | null>
  customDimensionLabels?: CustomDimensionLabels | null
  annotations?: Annotation[]
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
  annotations,
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

  const showBestTimeScore = bestTimeScore !== undefined && bestTimeScore > 0

  // Build KPI items for rendering
  const kpiItems = [
    <Statistic
      key="sessions"
      title="Sessions"
      value={formatNumber(totals.sessions)}
      valueStyle={valueStyle}
      suffix={
        <ChangeIndicator
          value={totals.sessions_change}
          showComparison={showComparison}
        />
      }
    />,
    <Statistic
      key="timescore"
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
    />,
    ...(showBestTimeScore ? [
      <Popover
        key="best-timescore"
        content={
          <div className="text-sm">
            <div className="font-medium mb-2">Best performing combination:</div>
            {maxDimensionValues && Object.keys(maxDimensionValues).length > 0 ? (
              <div className="space-y-1">
                {Object.entries(maxDimensionValues).map(([dim, value]) => (
                  <div key={dim} className="flex gap-2">
                    <span className="text-gray-500">{getDimensionLabel(dim, customDimensionLabels)}:</span>
                    <span className="font-medium">
                      {value === null || value === ''
                        ? '(not set)'
                        : dim === 'day_of_week' && typeof value === 'number'
                          ? DaysOfWeek[value] ?? String(value)
                          : String(value)}
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
    ] : []),
    <Statistic
      key="bounce"
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
    />,
    <Statistic
      key="scroll"
      title={<span className={annotations && annotations.length > 0 ? '' : 'md:pr-[70px]'}>Median Scroll Depth</span>}
      value={totals.median_scroll.toFixed(1)}
      valueStyle={valueStyle}
      suffix={
        <>
          %
          <ChangeIndicator
            value={totals.median_scroll_change}
            showComparison={showComparison}
          />
        </>
      }
    />,
    ...(annotations && annotations.length > 0 ? [
      <Popover
        key="annotations"
        content={
          <div className="text-sm max-w-xs">
            <div className="font-medium mb-2">Annotations in this period:</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {annotations.map((annotation) => (
                <div key={annotation.id} className="flex gap-2 items-start">
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: annotation.color || '#7763f1',
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div className="font-medium">{annotation.title}</div>
                    <div className="text-gray-500 text-xs">
                      {annotation.date} at {annotation.time} in {annotation.timezone}
                    </div>
                    {annotation.description && (
                      <div className="text-gray-600 text-xs mt-1">{annotation.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        }
        title={null}
        trigger="hover"
      >
        <div style={{ cursor: 'pointer' }}>
          <Statistic
            title={<span className="md:pr-[70px]">Annotations</span>}
            value={annotations.length}
            valueStyle={valueStyle}
          />
        </div>
      </Popover>
    ] : []),
  ]

  return (
    <div className="bg-white rounded-md px-6 py-4 mb-6">
      {/* Mobile: 2-column grid */}
      <div className="grid grid-cols-2 gap-4 md:hidden">
        {kpiItems}
      </div>
      {/* Desktop: horizontal flex with dividers */}
      <div className="hidden md:flex justify-between items-center">
        {kpiItems.map((item, index) => (
          <div key={index} className="contents">
            {item}
            {index < kpiItems.length - 1 && (
              <Divider type="vertical" style={{ height: 40 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
