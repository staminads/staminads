import { ChevronUp, ChevronDown } from 'lucide-react'
import { getHeatMapStyle } from '../../lib/explore-utils'
import { formatDuration } from '../../lib/chart-utils'

interface HeatMapCellProps {
  value: number
  bestValue: number
  referenceValue?: number
  previousValue?: number
  changePercent?: number
  showComparison?: boolean
}

export function HeatMapCell({
  value,
  bestValue,
  referenceValue,
  previousValue,
  changePercent,
  showComparison = false,
}: HeatMapCellProps) {
  const style = getHeatMapStyle(value, bestValue, referenceValue)

  // Format duration value (seconds to human readable)
  const formattedValue = formatDuration(value)

  // Determine change indicator
  const hasChange = showComparison && changePercent !== undefined && previousValue !== undefined
  const isPositive = hasChange && changePercent! > 0
  const isNegative = hasChange && changePercent! < 0

  return (
    <div className="flex items-center justify-end gap-1.5">
      <span style={style} />
      <span className="font-medium leading-tight">
        {formattedValue}
      </span>
      {hasChange && (
        <span
          className={`text-xs flex items-center justify-end w-12 ml-1 ${
            isPositive ? 'text-green-800' : isNegative ? 'text-orange-500' : 'text-gray-500'
          }`}
        >
          {isPositive ? <ChevronUp size={12} className="mr-0.5" /> : isNegative ? <ChevronDown size={12} className="mr-0.5" /> : null}
          {Math.abs(changePercent!).toFixed(0)}%
        </span>
      )}
    </div>
  )
}
