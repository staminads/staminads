import { useState } from 'react'
import { Tooltip, Empty, Spin } from 'antd'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { formatValue } from '../../lib/chart-utils'

export interface CountryData {
  dimension_value: string
  sessions: number
  median_duration: number
  prev_sessions?: number
  prev_median_duration?: number
}

type TabKey = 'sessions' | 'median_duration'

interface Tab {
  key: TabKey
  label: string
}

const TABS: Tab[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'median_duration', label: 'TimeScore' },
]

interface TabbedCountriesWidgetProps {
  title: string
  data: CountryData[]
  loading: boolean
  showComparison?: boolean
  emptyText?: string
}

export function TabbedCountriesWidget({
  title,
  data,
  loading,
  showComparison = true,
  emptyText = 'No data available',
}: TabbedCountriesWidgetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('sessions')

  // Sort data client-side based on active tab
  const sortedData = [...data].sort((a, b) => b[activeTab] - a[activeTab])
  const maxValue = sortedData[0]?.[activeTab] ?? 1

  const getChange = (current: number, previous?: number) => {
    if (!previous || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Title */}
      <div className="px-4 pt-4 pb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 px-4 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-2 text-xs transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab.key
                ? 'text-gray-900 border-[var(--primary)]'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table header */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200">
        <span className="flex-1 text-xs font-medium text-gray-600">Country</span>
        <span className={`text-xs font-medium text-gray-500 text-right ${showComparison ? 'w-26' : 'w-16'}`}>Sessions</span>
        <span className={`text-xs font-medium text-gray-500 text-right ${showComparison ? 'w-26' : 'w-16'}`}>TimeScore</span>
      </div>

      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spin />
        </div>
      ) : data.length === 0 ? (
        <Empty
          description={emptyText}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <div className="flex flex-col">
          {sortedData.map((row) => {
            const percent = (row[activeTab] / maxValue) * 100
            const displayValue = row.dimension_value || '(empty)'
            const sessionsChange = showComparison ? getChange(row.sessions, row.prev_sessions) : null
            const durationChange = showComparison ? getChange(row.median_duration, row.prev_median_duration) : null

            return (
              <div
                key={row.dimension_value}
                className="group/row relative flex items-center h-9 px-4 border-b border-transparent hover:border-[var(--primary)]"
              >
                {/* Dimension value */}
                <div className="relative flex-1 min-w-0 pr-4 h-full flex items-center pl-0.5 gap-2">
                  {/* Background bar */}
                  <div
                    className="absolute left-0 top-1 bottom-1 bg-[var(--primary)] opacity-[0.06] pointer-events-none rounded"
                    style={{ width: `${percent}%`, minWidth: '0.5rem' }}
                  />
                  {row.dimension_value && (
                    <span className={`fi fi-${row.dimension_value.toLowerCase()} flex-shrink-0 relative`} />
                  )}
                  <Tooltip title={displayValue} placement="topLeft">
                    <span className="relative truncate block text-xs text-gray-700 group-hover/row:text-gray-900">
                      {displayValue}
                    </span>
                  </Tooltip>
                </div>

                {/* Sessions value */}
                <div className="w-16 text-right">
                  <span className="text-xs text-gray-800">
                    {formatValue(row.sessions, 'number')}
                  </span>
                </div>
                {showComparison && (
                  <span className={`text-xs w-10 text-right ${sessionsChange !== null ? (sessionsChange >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-transparent'}`}>
                    {sessionsChange !== null ? (
                      <>
                        {sessionsChange >= 0 ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
                        {Math.abs(sessionsChange).toFixed(0)}%
                      </>
                    ) : '—'}
                  </span>
                )}

                {/* TimeScore value */}
                <div className="w-16 text-right">
                  <span className="text-xs text-gray-800">
                    {formatValue(row.median_duration, 'duration')}
                  </span>
                </div>
                {showComparison && (
                  <span className={`text-xs w-10 text-right ${durationChange !== null ? (durationChange >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-transparent'}`}>
                    {durationChange !== null ? (
                      <>
                        {durationChange >= 0 ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
                        {Math.abs(durationChange).toFixed(0)}%
                      </>
                    ) : '—'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
