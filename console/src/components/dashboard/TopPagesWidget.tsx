import { Tooltip, Empty, Spin } from 'antd'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { formatValue } from '../../lib/chart-utils'

export interface PageData {
  landing_path: string
  sessions: number
  median_duration: number
  bounce_rate: number
  prev_sessions?: number
  prev_median_duration?: number
}

interface TopPagesWidgetProps {
  title: string
  data: PageData[]
  loading: boolean
  sortBy: 'sessions' | 'median_duration'
  showBounceRate?: boolean
  showComparison?: boolean
  workspaceId: string
}

export function TopPagesWidget({
  title,
  data,
  loading,
  sortBy,
  showBounceRate = false,
  showComparison = true,
  workspaceId,
}: TopPagesWidgetProps) {
  const navigate = useNavigate()

  // Sort data client-side based on sortBy prop
  const sortedData = [...data].sort((a, b) => b[sortBy] - a[sortBy])
  const maxValue = sortedData[0]?.[sortBy] ?? 1

  const handleRowClick = (_path: string) => {
    // TODO: Add filter_path search param when Explore page implements filtering
    navigate({
      to: '/workspaces/$workspaceId/explore',
      params: { workspaceId },
    })
  }

  // Calculate change percentage
  const getChange = (current: number, previous?: number) => {
    if (!previous || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  const getValue = (row: PageData) => row[sortBy]
  const getPrevValue = (row: PageData) =>
    sortBy === 'sessions' ? row.prev_sessions : row.prev_median_duration
  const formatType = sortBy === 'sessions' ? 'number' : 'duration'
  const metricLabel = sortBy === 'sessions' ? 'Sessions' : 'TimeScore'

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Table header */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200">
        <span className="flex-1 text-sm font-medium text-gray-600">{title}</span>
        <span className="text-xs font-medium text-gray-500">
          {metricLabel}
        </span>
        {showComparison && <span className="w-12" />}
      </div>
      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spin />
        </div>
      ) : data.length === 0 ? (
        <Empty
          description="No page data available"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <div className="flex flex-col">
          {sortedData.map((row) => {
            const value = getValue(row)
            const prevValue = getPrevValue(row)
            const percent = (value / maxValue) * 100
            const change = showComparison ? getChange(value, prevValue) : null

            return (
              <div
                key={row.landing_path}
                onClick={() => handleRowClick(row.landing_path)}
                className="group/row relative flex items-center border-b border-gray-200 hover:border-[var(--primary)] last:border-0 h-9 cursor-pointer px-4"
              >
                {/* Background bar */}
                <div
                  className="absolute left-4 top-1.5 bottom-1.5 bg-[var(--primary)] opacity-10 pointer-events-none rounded"
                  style={{ width: `calc((100% - 7rem) * ${percent / 100})` }}
                />
                {/* Page path */}
                <div className="relative flex-1 min-w-0 pr-4 h-full flex items-center">
                  <Tooltip title={row.landing_path} placement="topLeft">
                    <span className="relative truncate block text-sm text-gray-700 group-hover/row:text-gray-900">
                      {row.landing_path}
                    </span>
                  </Tooltip>
                </div>

                {/* Bounce rate (if enabled) */}
                {showBounceRate && (
                  <div className="w-14 text-right text-sm text-gray-500 font-mono">
                    {formatValue(row.bounce_rate, 'percentage')}
                  </div>
                )}

                {/* Main metric value */}
                <div className="flex items-center justify-end ml-4">
                  <span className="text-sm font-semibold text-gray-800">
                    {formatValue(value, formatType)}
                  </span>
                  {showComparison && (
                    <span className={`text-xs w-12 text-right ${change !== null ? (change >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-transparent'}`}>
                      {change !== null ? (
                        <>
                          {change >= 0 ? <ChevronUp size={12} className="mr-0.5 inline" /> : <ChevronDown size={12} className="mr-0.5 inline" />}
                          {Math.abs(change).toFixed(0)}%
                        </>
                      ) : '—'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
