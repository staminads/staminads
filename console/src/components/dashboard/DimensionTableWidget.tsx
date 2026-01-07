import { useState, useMemo, useRef, useCallback } from 'react'
import { Tooltip, Empty, Spin, Drawer, Pagination } from 'antd'
import { ChevronUp, ChevronDown, ArrowUp, ArrowDown, Info, Maximize2, TrendingUp } from 'lucide-react'
import { formatValue } from '../../lib/chart-utils'
import { getHeatMapStyle } from '../../lib/explore-utils'
import { useDimensionQuery } from '../../hooks/useDimensionQuery'
import { useDashboardContext } from '../../hooks/useDashboardContext'
import { CountryMapView } from './CountryMapView'
import type { DimensionTableWidgetProps, DimensionData } from '../../types/dashboard'

type SortKey = 'sessions' | 'median_duration'
type SortDirection = 'asc' | 'desc'

const EXPANDED_LIMIT = 200
const PAGE_SIZE = 20

export function DimensionTableWidget({
  title,
  infoTooltip,
  tabs,
  iconPrefix,
  onRowClick,
  emptyText = 'No data available',
}: DimensionTableWidgetProps) {
  const { showComparison, timescoreReference } = useDashboardContext()
  const [activeTabKey, setActiveTabKey] = useState(tabs[0].key)
  const [sortBy, setSortBy] = useState<SortKey>('sessions')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [showEvoDetails, setShowEvoDetails] = useState(false)

  const activeTab = tabs.find((t) => t.key === activeTabKey) ?? tabs[0]
  const isMapView = activeTab.type === 'country_map'
  const orderOverride = useMemo(
    () => ({ [sortBy]: sortDirection }),
    [sortBy, sortDirection]
  )

  // For map views, use the tab's limit (typically 100); for tables, use default (7)
  const tableLimit = 7
  const { data: rawData, loading } = useDimensionQuery(activeTab, {
    orderOverride: isMapView ? undefined : orderOverride,
    limitOverride: isMapView ? activeTab.limit : undefined,
  })

  // For list views, slice data to tableLimit to prevent flash of extra items
  // when switching from map view (which has more items) due to keepPreviousData
  const data = useMemo(() => {
    if (isMapView) return rawData
    return rawData.slice(0, tableLimit)
  }, [rawData, isMapView])

  // Expanded data for drawer (only fetch when drawer is open)
  const { data: expandedData, loading: expandedLoading } = useDimensionQuery(
    activeTab,
    {
      limitOverride: drawerOpen ? EXPANDED_LIMIT : undefined,
      orderOverride,
    }
  )

  // Max median_duration for heat map scaling
  const maxMedianDuration = useMemo(() => {
    return data.reduce((max, row) => Math.max(max, row.median_duration || 0), 0)
  }, [data])

  // Data is already sorted by API, just get max value for bar width
  const maxValue = data[0]?.[sortBy] ?? 1

  // Expanded data calculations for drawer
  const expandedMaxMedianDuration = useMemo(() => {
    return expandedData.reduce((max, row) => Math.max(max, row.median_duration || 0), 0)
  }, [expandedData])

  const expandedMaxValue = expandedData[0]?.[sortBy] ?? 1

  // Paginated data for drawer
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return expandedData.slice(startIndex, startIndex + PAGE_SIZE)
  }, [expandedData, currentPage])

  const getChange = (current: number, previous?: number) => {
    if (!previous || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  const sortDebounceRef = useRef(false)

  const handleHeaderClick = useCallback((key: SortKey) => {
    if (sortDebounceRef.current) return
    sortDebounceRef.current = true

    if (sortBy === key) {
      // Toggle direction when clicking the same column
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      // New column: set to desc by default
      setSortBy(key)
      setSortDirection('desc')
    }
    setCurrentPage(1)

    setTimeout(() => {
      sortDebounceRef.current = false
    }, 300)
  }, [sortBy])

  const handleTabChange = (key: string) => {
    setActiveTabKey(key)
    setCurrentPage(1)
  }

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Title */}
      <div className="px-4 pt-4 pb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          {title}
          {infoTooltip && (
            <Tooltip title={infoTooltip}>
              <Info size={14} className="text-gray-400 cursor-help" />
            </Tooltip>
          )}
        </h3>
        {/* Hide expand button for map views */}
        {!isMapView && (
          <div className="flex items-center gap-1">
            {/* Growth toggle - mobile only, only when comparison is shown */}
            {showComparison && (
              <Tooltip title={showEvoDetails ? 'Hide percentages' : 'Show percentages'}>
                <button
                  onClick={() => setShowEvoDetails(!showEvoDetails)}
                  className={`p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer md:hidden ${showEvoDetails ? 'text-[var(--primary)]' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <TrendingUp size={16} />
                </button>
              </Tooltip>
            )}
            <Tooltip title="Expand">
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <Maximize2 size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Dimension Tabs (only show if multiple tabs) */}
      {tabs.length > 1 && (
        <div className="flex gap-4 px-4 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTabKey(tab.key)}
              className={`pb-2 text-xs transition-colors border-b-2 -mb-px cursor-pointer ${
                activeTabKey === tab.key
                  ? 'text-gray-900 border-[var(--primary)]'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Map view for country_map type */}
      {isMapView ? (
        <CountryMapView
          data={data}
          loading={loading}
          onCountryClick={(countryCode) => {
            onRowClick?.({ dimension_value: countryCode, sessions: 0, median_duration: 0 }, activeTabKey)
          }}
        />
      ) : (
        <div className="overflow-x-auto">
          {/* Table header with clickable sort */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200">
        <span className="flex-1 min-w-[150px] md:min-w-0 text-xs font-medium text-gray-600 md:truncate whitespace-nowrap">
          {activeTab.dimensionLabel}
        </span>
        <div className="flex items-center sticky right-0 bg-white pl-2 md:static md:pl-0 md:bg-transparent">
          <button
            onClick={() => handleHeaderClick('sessions')}
            className={`text-xs font-medium text-right cursor-pointer hover:text-gray-900 flex items-center justify-end gap-0.5 w-16 md:w-24 flex-shrink-0 ${sortBy === 'sessions' ? 'text-gray-900' : 'text-gray-500'}`}
          >
            Sessions
            {sortBy === 'sessions' ? (
              sortDirection === 'desc' ? (
                <ArrowDown size={12} className="text-[var(--primary)]" />
              ) : (
                <ArrowUp size={12} className="text-[var(--primary)]" />
              )
            ) : (
              <ArrowDown size={12} className="opacity-0" />
            )}
          </button>
          <button
            onClick={() => handleHeaderClick('median_duration')}
            className={`text-xs font-medium pl-6 cursor-pointer hover:text-gray-900 flex items-center gap-0.5 w-28 md:w-36 flex-shrink-0 ${sortBy === 'median_duration' ? 'text-gray-900' : 'text-gray-500'}`}
          >
            TimeScore
            {sortBy === 'median_duration' ? (
              sortDirection === 'desc' ? (
                <ArrowDown size={12} className="text-[var(--primary)]" />
              ) : (
                <ArrowUp size={12} className="text-[var(--primary)]" />
              )
            ) : (
              <ArrowDown size={12} className="opacity-0" />
            )}
          </button>
        </div>
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
          {data.map((row) => (
            <DimensionRow
              key={row.dimension_value}
              row={row}
              sortBy={sortBy}
              maxValue={maxValue}
              maxMedianDuration={maxMedianDuration}
              timescoreReference={timescoreReference}
              showComparison={showComparison}
              showEvoDetails={showEvoDetails}
              iconPrefix={iconPrefix?.(row.dimension_value, activeTabKey)}
              onClick={onRowClick ? () => onRowClick(row, activeTabKey) : undefined}
              getChange={getChange}
            />
          ))}
        </div>
      )}
        </div>
      )}

      {/* Expanded Drawer (only for table views) */}
      {!isMapView && (
      <Drawer
        title={
          <div className="flex items-center gap-2">
            {title}
            <Tooltip title="Limited to top 200 results for performance">
              <Info size={14} className="text-gray-400 cursor-help" />
            </Tooltip>
          </div>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={600}
        styles={{ body: { padding: 0, paddingTop: 16 } }}
      >
        {/* Dimension Tabs in drawer (only show if multiple tabs) */}
        {tabs.length > 1 && (
          <div className="flex gap-4 px-4 border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`pb-2 text-xs transition-colors border-b-2 -mb-px cursor-pointer ${
                  activeTabKey === tab.key
                    ? 'text-gray-900 border-[var(--primary)]'
                    : 'text-gray-500 border-transparent hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Table header with clickable sort */}
        <div className="flex items-center px-4 py-3 border-b border-gray-200">
          <span className="flex-1 min-w-0 text-xs font-medium text-gray-600 truncate">
            {activeTab.dimensionLabel}
          </span>
          <button
            onClick={() => handleHeaderClick('sessions')}
            className={`text-xs font-medium text-right cursor-pointer hover:text-gray-900 flex items-center justify-end gap-0.5 w-16 md:w-24 flex-shrink-0 ${sortBy === 'sessions' ? 'text-gray-900' : 'text-gray-500'}`}
          >
            Sessions
            {sortBy === 'sessions' ? (
              sortDirection === 'desc' ? (
                <ArrowDown size={12} className="text-[var(--primary)]" />
              ) : (
                <ArrowUp size={12} className="text-[var(--primary)]" />
              )
            ) : (
              <ArrowDown size={12} className="opacity-0" />
            )}
          </button>
          <button
            onClick={() => handleHeaderClick('median_duration')}
            className={`text-xs font-medium pl-6 cursor-pointer hover:text-gray-900 flex items-center gap-0.5 w-28 md:w-36 flex-shrink-0 ${sortBy === 'median_duration' ? 'text-gray-900' : 'text-gray-500'}`}
          >
            TimeScore
            {sortBy === 'median_duration' ? (
              sortDirection === 'desc' ? (
                <ArrowDown size={12} className="text-[var(--primary)]" />
              ) : (
                <ArrowUp size={12} className="text-[var(--primary)]" />
              )
            ) : (
              <ArrowDown size={12} className="opacity-0" />
            )}
          </button>
        </div>

        {/* Drawer content */}
        {expandedLoading && expandedData.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Spin />
          </div>
        ) : expandedData.length === 0 ? (
          <Empty
            description={emptyText}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="py-8"
          />
        ) : (
          <>
            <div className="flex flex-col">
              {paginatedData.map((row) => (
                <DimensionRow
                  key={row.dimension_value}
                  row={row}
                  sortBy={sortBy}
                  maxValue={expandedMaxValue}
                  maxMedianDuration={expandedMaxMedianDuration}
                  timescoreReference={timescoreReference}
                  showComparison={showComparison}
                  showEvoDetails={true}
                  iconPrefix={iconPrefix?.(row.dimension_value, activeTabKey)}
                  onClick={onRowClick ? () => onRowClick(row, activeTabKey) : undefined}
                  getChange={getChange}
                />
              ))}
            </div>
            {expandedData.length > PAGE_SIZE && (
              <div className="flex justify-center py-4 border-t border-gray-100">
                <Pagination
                  current={currentPage}
                  total={expandedData.length}
                  pageSize={PAGE_SIZE}
                  onChange={setCurrentPage}
                  showSizeChanger={false}
                  size="small"
                />
              </div>
            )}
          </>
        )}
      </Drawer>
      )}
    </div>
  )
}

interface DimensionRowProps {
  row: DimensionData
  sortBy: SortKey
  maxValue: number
  maxMedianDuration: number
  timescoreReference: number
  showComparison: boolean
  showEvoDetails: boolean
  iconPrefix?: React.ReactNode
  onClick?: () => void
  getChange: (current: number, previous?: number) => number | null
}

function DimensionRow({
  row,
  sortBy,
  maxValue,
  maxMedianDuration,
  timescoreReference,
  showComparison,
  showEvoDetails,
  iconPrefix,
  onClick,
  getChange,
}: DimensionRowProps) {
  const percent = (row[sortBy] / maxValue) * 100
  const displayValue = row.dimension_value || '(empty)'
  const sessionsChange = showComparison ? getChange(row.sessions, row.prev_sessions) : null
  const durationChange = showComparison ? getChange(row.median_duration, row.prev_median_duration) : null

  return (
    <div
      onClick={onClick}
      className={`group/row relative flex items-center h-9 px-4 border-b border-transparent hover:border-[var(--primary)] ${onClick ? 'cursor-pointer' : ''}`}
    >
      {/* Dimension value */}
      <div className="relative flex-1 min-w-0 pr-4 h-full flex items-center pl-1.5 gap-2 overflow-hidden">
        {/* Background bar */}
        <div
          className="absolute left-0 top-1 bottom-1 bg-[var(--primary)] opacity-[0.06] pointer-events-none rounded"
          style={{ width: `${percent}%`, minWidth: '0.5rem' }}
        />
        {iconPrefix}
        <Tooltip title={displayValue} placement="topLeft">
          <span className="relative truncate block text-xs text-gray-700 group-hover/row:text-gray-900">
            {displayValue}
          </span>
        </Tooltip>
      </div>

      {/* Sessions value */}
      <div className="text-right w-16 md:w-24 flex-shrink-0">
        {/* Mobile: toggle between value+caret and evo% */}
        <span className="md:hidden">
          {showEvoDetails && showComparison ? (
            <span
              className={`text-xs ${sessionsChange !== null ? (sessionsChange >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-gray-400'}`}
            >
              {sessionsChange !== null ? (
                <>
                  {sessionsChange >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                  {Math.abs(sessionsChange).toFixed(0)}%
                </>
              ) : '—'}
            </span>
          ) : (
            <span className="text-xs text-gray-800 inline-flex items-center justify-end gap-0.5">
              {formatValue(row.sessions, 'number')}
              {showComparison && sessionsChange !== null && (
                sessionsChange >= 0 ? <ChevronUp size={14} className="text-green-600" /> : <ChevronDown size={14} className="text-orange-500" />
              )}
            </span>
          )}
        </span>
        {/* Desktop: always show value + full evo% */}
        <span className="hidden md:inline-flex items-center justify-end gap-1 text-xs text-gray-800">
          {formatValue(row.sessions, 'number')}
          {showComparison && sessionsChange !== null && (
            <span className={sessionsChange >= 0 ? 'text-green-600' : 'text-orange-500'}>
              {sessionsChange >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
              {Math.abs(sessionsChange).toFixed(0)}%
            </span>
          )}
        </span>
      </div>

      {/* TimeScore value */}
      <div className="w-28 md:w-36 flex-shrink-0 flex items-center gap-2 pl-6">
        <span style={getHeatMapStyle(row.median_duration, maxMedianDuration, timescoreReference)} />
        {/* Mobile: toggle between value+caret and evo% */}
        <span className="md:hidden">
          {showEvoDetails && showComparison ? (
            <span
              className={`text-xs ${durationChange !== null ? (durationChange >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-gray-400'}`}
            >
              {durationChange !== null ? (
                <>
                  {durationChange >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                  {Math.abs(durationChange).toFixed(0)}%
                </>
              ) : '—'}
            </span>
          ) : (
            <span className="text-xs text-gray-800 inline-flex items-center gap-0.5">
              {formatValue(row.median_duration, 'duration')}
              {showComparison && durationChange !== null && (
                durationChange >= 0 ? <ChevronUp size={14} className="text-green-600" /> : <ChevronDown size={14} className="text-orange-500" />
              )}
            </span>
          )}
        </span>
        {/* Desktop: always show value + full evo% */}
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-gray-800">
          {formatValue(row.median_duration, 'duration')}
          {showComparison && durationChange !== null && (
            <span className={durationChange >= 0 ? 'text-green-600' : 'text-orange-500'}>
              {durationChange >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
              {Math.abs(durationChange).toFixed(0)}%
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
