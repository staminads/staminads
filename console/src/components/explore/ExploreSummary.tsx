import { Skeleton } from 'antd'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { ExploreTotals } from '../../types/explore'
import { formatNumber } from '../../lib/chart-utils'

interface ExploreSummaryProps {
  totals?: ExploreTotals
  showComparison: boolean
  loading?: boolean
  timescoreReference?: number
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function ChangeIndicator({ value, invertColors = false }: { value?: number; invertColors?: boolean }) {
  if (value === undefined || value === null) return null

  const isPositive = value > 0
  const isNegative = value < 0

  // For metrics where lower is better, invert the colors
  const positiveColor = invertColors ? 'text-orange-500' : 'text-green-600'
  const negativeColor = invertColors ? 'text-green-600' : 'text-orange-500'

  return (
    <span
      className={`text-sm flex items-center ml-2 ${
        isPositive ? positiveColor : isNegative ? negativeColor : 'text-gray-500'
      }`}
    >
      {isPositive ? <ChevronUp size={14} /> : isNegative ? <ChevronDown size={14} /> : null}
      {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export function ExploreSummary({ totals, showComparison, loading, timescoreReference = 60 }: ExploreSummaryProps) {
  if (loading || !totals) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-8">
          <Skeleton.Input active size="small" style={{ width: 120 }} />
          <Skeleton.Input active size="small" style={{ width: 120 }} />
        </div>
      </div>
    )
  }

  // Calculate heat color based on timescore reference
  const getHeatColor = (value: number, reference: number): string => {
    const ratio = Math.min(value / reference, 1)
    // Green gradient: lower saturation for low values, higher for good values
    const hue = 142 // Green hue
    const saturation = Math.round(30 + ratio * 50)
    const lightness = Math.round(90 - ratio * 40)
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
      <div className="flex items-center gap-8">
        {/* Total Sessions */}
        <div className="flex items-center">
          <span className="text-gray-500 text-sm mr-2">Sessions</span>
          <span className="text-lg font-semibold text-gray-800">
            {formatNumber(totals.sessions)}
          </span>
          {showComparison && <ChangeIndicator value={totals.sessions_change} />}
        </div>

        {/* Median TimeScore */}
        <div className="flex items-center">
          <span className="text-gray-500 text-sm mr-2">Median TimeScore</span>
          <span
            className="text-lg font-semibold px-2 py-0.5 rounded"
            style={{ backgroundColor: getHeatColor(totals.median_duration, timescoreReference) }}
          >
            {formatDuration(totals.median_duration)}
          </span>
          {showComparison && <ChangeIndicator value={totals.median_duration_change} />}
        </div>
      </div>
    </div>
  )
}
