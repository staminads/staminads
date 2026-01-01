import { Card, Tooltip, Empty, Spin } from 'antd'
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

  return (
    <Card
      title={<span className="text-sm font-medium text-gray-600">{title}</span>}
      className="shadow-sm"
      styles={{ body: { padding: 0 }, header: { minHeight: 'auto', padding: '12px 16px' } }}
    >
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
                className="group/row relative border-b border-gray-200 hover:border-[var(--primary)] last:border-0 h-9 overflow-hidden cursor-pointer"
              >
                {/* Background bar */}
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                  <div
                    className="h-full bg-gray-100"
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {/* Content */}
                <div className="relative h-full flex items-center px-4">
                  {/* Page path */}
                  <div className="flex-1 min-w-0 pr-4">
                    <Tooltip title={row.landing_path} placement="topLeft">
                      <span className="truncate block text-sm text-gray-700 group-hover/row:text-gray-900">
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
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
