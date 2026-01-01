import { ChevronUp, ChevronDown } from 'lucide-react'
import { getHeatMapStyle } from '../../lib/explore-utils'
import { formatDuration } from '../../lib/chart-utils'

interface HeatMapCellProps {
  value: number
  bestValue: number
  previousValue?: number
  changePercent?: number
  showComparison?: boolean
}

export function HeatMapCell({
  value,
  bestValue,
  previousValue,
  changePercent,
  showComparison = false,
}: HeatMapCellProps) {
  const style = getHeatMapStyle(value, bestValue)

  // Format duration value (seconds to human readable)
  const formattedValue = formatDuration(value)

  // Determine change indicator
  const hasChange = showComparison && changePercent !== undefined && previousValue !== undefined
  const isPositive = hasChange && changePercent! > 0
  const isNegative = hasChange && changePercent! < 0

  return (
    <div
      className="px-2 py-1 -mx-2 -my-1 rounded"
      style={style}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{formattedValue}</span>
        {hasChange && (
          <span
            className={`text-xs flex items-center justify-end w-12 ${
              isPositive ? 'text-green-800' : isNegative ? 'text-orange-500' : 'text-gray-500'
            }`}
          >
            {isPositive ? <ChevronUp size={12} className="mr-0.5" /> : isNegative ? <ChevronDown size={12} className="mr-0.5" /> : null}
            {Math.abs(changePercent!).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  )
}
