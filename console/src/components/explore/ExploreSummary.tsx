import { Skeleton } from 'antd'
import { ChevronUp, ChevronDown, Minus } from 'lucide-react'
import type { ExploreTotals } from '../../types/explore'
import { formatNumber } from '../../lib/chart-utils'

interface ExploreSummaryProps {
  totals?: ExploreTotals
  showComparison: boolean
  loading?: boolean
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

interface ChangeIndicatorProps {
  value?: number
  invertColors?: boolean
}

function ChangeIndicator({ value, invertColors = false }: ChangeIndicatorProps) {
  if (value === undefined || value === null) return null

  const isPositive = value > 0
  const isNegative = value < 0
  const isNeutral = value === 0

  // For metrics where lower is better (e.g., bounce rate), invert the colors
  const positiveColor = invertColors ? 'text-orange-500' : 'text-green-600'
  const negativeColor = invertColors ? 'text-green-600' : 'text-orange-500'

  return (
    <span
      className={`text-xs flex items-center ${
        isPositive ? positiveColor : isNegative ? negativeColor : 'text-gray-400'
      }`}
    >
      {isPositive ? (
        <ChevronUp size={12} />
      ) : isNegative ? (
        <ChevronDown size={12} />
      ) : isNeutral ? (
        <Minus size={10} className="mr-0.5" />
      ) : null}
      {Math.abs(value).toFixed(1)}%
    </span>
  )
}

interface MetricItemProps {
  label: string
  value: string
  change?: number
  invertColors?: boolean
  showComparison: boolean
}

function MetricItem({ label, value, change, invertColors, showComparison }: MetricItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-base font-semibold text-gray-800">{value}</span>
      {showComparison && <ChangeIndicator value={change} invertColors={invertColors} />}
    </div>
  )
}

export function ExploreSummary({ totals, showComparison, loading }: ExploreSummaryProps) {
  if (loading || !totals) {
    return (
      <div className="bg-white rounded-md px-5 py-3 mb-4">
        <div className="flex items-center gap-8">
          <Skeleton.Input active size="small" style={{ width: 100 }} />
          <Skeleton.Input active size="small" style={{ width: 100 }} />
          <Skeleton.Input active size="small" style={{ width: 100 }} />
          <Skeleton.Input active size="small" style={{ width: 100 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-md px-5 py-3 mb-4">
      <div className="flex items-center justify-between">
        <MetricItem
          label="Sessions"
          value={formatNumber(totals.sessions)}
          change={totals.sessions_change}
          showComparison={showComparison}
        />

        <MetricItem
          label="TimeScore"
          value={formatDuration(totals.median_duration)}
          change={totals.median_duration_change}
          showComparison={showComparison}
        />

        <MetricItem
          label="Bounce Rate"
          value={formatPercent(totals.bounce_rate)}
          change={totals.bounce_rate_change}
          invertColors={true}
          showComparison={showComparison}
        />

        <MetricItem
          label="Avg. Scroll"
          value={formatPercent(totals.max_scroll)}
          change={totals.max_scroll_change}
          showComparison={showComparison}
        />
      </div>
    </div>
  )
}
