import { useState, useMemo } from 'react'
import { Tooltip, Empty, Spin } from 'antd'
import { ChevronUp, ChevronDown, ArrowDown } from 'lucide-react'
import { formatValue } from '../../lib/chart-utils'
import { getHeatMapStyle } from '../../lib/explore-utils'

export interface DeviceData {
  dimension_value: string
  sessions: number
  median_duration: number
  prev_sessions?: number
  prev_median_duration?: number
}

type DimensionTab = 'devices' | 'browsers' | 'os'
type SortKey = 'sessions' | 'median_duration'

interface DimensionTabConfig {
  key: DimensionTab
  label: string
}

const DIMENSION_TABS: DimensionTabConfig[] = [
  { key: 'devices', label: 'Devices' },
  { key: 'browsers', label: 'Browsers' },
  { key: 'os', label: 'OS' },
]

interface TabbedDevicesWidgetProps {
  title: string
  devicesData: DeviceData[]
  browsersData: DeviceData[]
  osData: DeviceData[]
  devicesLoading: boolean
  browsersLoading: boolean
  osLoading: boolean
  showComparison?: boolean
  timescoreReference?: number
}

export function TabbedDevicesWidget({
  title,
  devicesData,
  browsersData,
  osData,
  devicesLoading,
  browsersLoading,
  osLoading,
  showComparison = true,
  timescoreReference = 60,
}: TabbedDevicesWidgetProps) {
  const [activeDimension, setActiveDimension] = useState<DimensionTab>('devices')
  const [sortBy, setSortBy] = useState<SortKey>('sessions')

  // Get data and loading state for active dimension
  const { data, loading } = useMemo(() => {
    switch (activeDimension) {
      case 'devices':
        return { data: devicesData, loading: devicesLoading }
      case 'browsers':
        return { data: browsersData, loading: browsersLoading }
      case 'os':
        return { data: osData, loading: osLoading }
    }
  }, [activeDimension, devicesData, browsersData, osData, devicesLoading, browsersLoading, osLoading])

  // Max median_duration for heat map scaling
  const maxMedianDuration = useMemo(() => {
    return data.reduce((max, row) => Math.max(max, row.median_duration || 0), 0)
  }, [data])

  // Sort data client-side based on sort key
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => b[sortBy] - a[sortBy])
  }, [data, sortBy])

  const maxValue = sortedData[0]?.[sortBy] ?? 1

  const getChange = (current: number, previous?: number) => {
    if (!previous || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  const handleHeaderClick = (key: SortKey) => {
    setSortBy(key)
  }

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Title */}
      <div className="px-4 pt-4 pb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>

      {/* Dimension Tabs */}
      <div className="flex gap-4 px-4 border-b border-gray-200">
        {DIMENSION_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveDimension(tab.key)}
            className={`pb-2 text-xs transition-colors border-b-2 -mb-px cursor-pointer ${
              activeDimension === tab.key
                ? 'text-gray-900 border-[var(--primary)]'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table header with clickable sort */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200">
        <span className="flex-1 text-xs font-medium text-gray-600">
          {activeDimension === 'devices' ? 'Device' : activeDimension === 'browsers' ? 'Browser' : 'OS'}
        </span>
        <button
          onClick={() => handleHeaderClick('sessions')}
          className={`text-xs font-medium text-right cursor-pointer hover:text-gray-900 flex items-center justify-end gap-0.5 ${showComparison ? 'w-28' : 'w-16'} ${sortBy === 'sessions' ? 'text-gray-900' : 'text-gray-500'}`}
        >
          Sessions
          {sortBy === 'sessions' && <ArrowDown size={12} className="text-[var(--primary)]" />}
        </button>
        <button
          onClick={() => handleHeaderClick('median_duration')}
          className={`text-xs font-medium pl-6 cursor-pointer hover:text-gray-900 flex items-center gap-0.5 ${showComparison ? 'w-34' : 'w-24'} ${sortBy === 'median_duration' ? 'text-gray-900' : 'text-gray-500'}`}
        >
          TimeScore
          {sortBy === 'median_duration' && <ArrowDown size={12} className="text-[var(--primary)]" />}
        </button>
      </div>

      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spin />
        </div>
      ) : data.length === 0 ? (
        <Empty
          description="No data available"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <div className="flex flex-col">
          {sortedData.map((row) => {
            const percent = (row[sortBy] / maxValue) * 100
            const displayValue = row.dimension_value || '(empty)'
            const sessionsChange = showComparison ? getChange(row.sessions, row.prev_sessions) : null
            const durationChange = showComparison ? getChange(row.median_duration, row.prev_median_duration) : null

            return (
              <div
                key={row.dimension_value}
                className="group/row relative flex items-center h-9 px-4 border-b border-transparent hover:border-[var(--primary)]"
              >
                {/* Dimension value */}
                <div className="relative flex-1 min-w-0 pr-4 h-full flex items-center pl-1.5">
                  {/* Background bar */}
                  <div
                    className="absolute left-0 top-1 bottom-1 bg-[var(--primary)] opacity-[0.06] pointer-events-none rounded"
                    style={{ width: `${percent}%`, minWidth: '0.5rem' }}
                  />
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
                  <span className={`text-[10px] w-12 text-right ${sessionsChange !== null ? (sessionsChange >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-transparent'}`}>
                    {sessionsChange !== null ? (
                      <>
                        {sessionsChange >= 0 ? <ChevronUp size={10} className="inline" /> : <ChevronDown size={10} className="inline" />}
                        {Math.abs(sessionsChange).toFixed(0)}%
                      </>
                    ) : '—'}
                  </span>
                )}

                {/* TimeScore value */}
                <div className="w-24 flex items-center gap-2 pl-6">
                  <span style={getHeatMapStyle(row.median_duration, maxMedianDuration, timescoreReference)} />
                  <span className="text-xs text-gray-800">
                    {formatValue(row.median_duration, 'duration')}
                  </span>
                </div>
                {showComparison && (
                  <span className={`text-[10px] w-10 text-right ${durationChange !== null ? (durationChange >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-transparent'}`}>
                    {durationChange !== null ? (
                      <>
                        {durationChange >= 0 ? <ChevronUp size={10} className="inline" /> : <ChevronDown size={10} className="inline" />}
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
