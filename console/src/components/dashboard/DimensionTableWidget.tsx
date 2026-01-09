import { useState, useMemo, useRef, useCallback } from 'react'
import { Tooltip, Empty, Spin, Drawer, Pagination } from 'antd'
import { ChevronUp, ChevronDown, ArrowUp, ArrowDown, Info, Maximize2, TrendingUp } from 'lucide-react'
import { formatValue, formatCurrency } from '../../lib/chart-utils'
import { getHeatMapStyle } from '../../lib/explore-utils'
import { useDimensionQuery } from '../../hooks/useDimensionQuery'
import { useDashboardContext } from '../../hooks/useDashboardContext'
import { CountryMapView } from './CountryMapView'
import type { DimensionTableWidgetProps, DimensionData, ColumnConfig } from '../../types/dashboard'

type SortDirection = 'asc' | 'desc'

const EXPANDED_LIMIT = 200
const PAGE_SIZE = 20

/** Default columns for backward compatibility (sessions tables) */
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'sessions', label: 'Sessions', format: 'number' },
  { key: 'median_duration', label: 'TimeScore', format: 'duration', heatMap: true },
]

export function DimensionTableWidget({
  title,
  infoTooltip,
  tabs,
  columns = DEFAULT_COLUMNS,
  iconPrefix,
  onRowClick,
  emptyText = 'No data available',
}: DimensionTableWidgetProps) {
  const { showComparison, timescoreReference, showEvoDetails, setShowEvoDetails } = useDashboardContext()
  const [activeTabKey, setActiveTabKey] = useState(tabs[0].key)
  const [sortBy, setSortBy] = useState<string>(columns[0].key)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null)

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

  // Find column with heatMap enabled and calculate max for scaling
  const heatMapColumn = columns.find((col) => col.heatMap)
  const maxHeatMapValue = useMemo(() => {
    if (!heatMapColumn) return 0
    return data.reduce((max, row) => Math.max(max, (row[heatMapColumn.key] as number) || 0), 0)
  }, [data, heatMapColumn])

  // Data is already sorted by API, just get max value for bar width
  const maxValue = (data[0]?.[sortBy] as number) ?? 1

  // Expanded data calculations for drawer
  const expandedMaxHeatMapValue = useMemo(() => {
    if (!heatMapColumn) return 0
    return expandedData.reduce((max, row) => Math.max(max, (row[heatMapColumn.key] as number) || 0), 0)
  }, [expandedData, heatMapColumn])

  const expandedMaxValue = (expandedData[0]?.[sortBy] as number) ?? 1

  // Paginated data for drawer
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return expandedData.slice(startIndex, startIndex + PAGE_SIZE)
  }, [expandedData, currentPage])

  const getChange = (current: number, previous?: number) => {
    if (!previous || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  // Helper for column-based layout hover coordination
  const getRowClasses = (index: number) =>
    `h-9 flex items-center border-b ${
      hoveredRowIndex === index ? 'border-[var(--primary)]' : 'border-transparent'
    } ${onRowClick ? 'cursor-pointer' : ''}`

  const rowInteractionProps = (index: number, row: DimensionData) => ({
    onClick: onRowClick ? () => onRowClick(row, activeTabKey) : undefined,
    onMouseEnter: () => setHoveredRowIndex(index),
    onMouseLeave: () => setHoveredRowIndex(null),
  })

  const sortDebounceRef = useRef(false)

  const handleHeaderClick = useCallback((key: string) => {
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
          <div className="flex items-center gap-2">
            {/* Growth toggle - mobile only, only when comparison is shown */}
            {showComparison && (
              <button
                onClick={() => setShowEvoDetails(!showEvoDetails)}
                className={`p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer md:hidden ${showEvoDetails ? 'text-[var(--primary)]' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <TrendingUp size={16} />
              </button>
            )}
            {/* Mobile: no tooltip */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer md:hidden"
            >
              <Maximize2 size={16} />
            </button>
            {/* Desktop: with tooltip */}
            <Tooltip title="Expand">
              <button
                onClick={() => setDrawerOpen(true)}
                className="hidden md:block p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
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
            onRowClick?.({ dimension_value: countryCode }, activeTabKey)
          }}
        />
      ) : loading && data.length === 0 ? (
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
        <div className="flex">
          {/* DIMENSION COLUMN - scrollable on mobile only */}
          <div className="flex-1 overflow-x-auto md:overflow-visible">
            <div className="min-w-max md:min-w-0">
              {/* Dimension header */}
              <div className="flex items-center h-[46px] px-4 border-b border-gray-200">
                <span className="text-xs font-medium text-gray-600 whitespace-nowrap md:truncate">
                  {activeTab.dimensionLabel}
                </span>
              </div>
              {/* Dimension cells */}
              {data.map((row, index) => {
                const percent = ((row[sortBy] as number) / maxValue) * 100
                return (
                  <div
                    key={row.dimension_value}
                    className={`${getRowClasses(index)} px-4 gap-2 relative`}
                    {...rowInteractionProps(index, row)}
                  >
                    {/* Background bar */}
                    <div
                      className="absolute inset-y-1 left-1.5 bg-[var(--primary)] opacity-[0.06] rounded pointer-events-none"
                      style={{ width: `${percent}%`, minWidth: '0.5rem' }}
                    />
                    {iconPrefix?.(row.dimension_value, activeTabKey)}
                    <span className="relative whitespace-nowrap md:truncate text-xs text-gray-700 pr-2">
                      {row.dimension_value || '(empty)'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* METRIC COLUMNS - static, never scroll */}
          {columns.map((col, colIndex) => {
            const isFirst = colIndex === 0
            const hasHeatMap = col.heatMap
            return (
              <div
                key={col.key}
                className={`${isFirst ? 'w-16 md:w-24' : 'w-28 md:w-36'} flex-shrink-0 bg-white md:bg-transparent`}
              >
                {/* Column header */}
                <div className={`flex items-center h-[46px] ${isFirst ? 'justify-end' : 'pl-6'} border-b border-gray-200`}>
                  <button
                    onClick={() => handleHeaderClick(col.key)}
                    className={`text-xs font-medium ${isFirst ? 'text-right' : ''} cursor-pointer hover:text-gray-900 flex items-center ${isFirst ? 'justify-end' : ''} gap-0.5 ${sortBy === col.key ? 'text-gray-900' : 'text-gray-500'}`}
                  >
                    {col.label}
                    {sortBy === col.key ? (
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
                {/* Column cells */}
                {data.map((row, index) => {
                  const value = row[col.key] as number
                  const prevValue = row[`prev_${col.key}`] as number | undefined
                  const change = showComparison ? getChange(value, prevValue) : null
                  const formattedValue = col.format === 'currency'
                    ? formatCurrency(value, col.currency)
                    : formatValue(value, col.format)

                  return (
                    <div
                      key={row.dimension_value}
                      className={`${getRowClasses(index)} ${isFirst ? 'justify-end' : 'gap-2 pl-6'}`}
                      {...rowInteractionProps(index, row)}
                    >
                      {hasHeatMap && (
                        <span style={getHeatMapStyle(value, maxHeatMapValue, timescoreReference)} />
                      )}
                      {/* Mobile: toggle between value+caret and evo% */}
                      <span className="md:hidden">
                        {showEvoDetails && showComparison ? (
                          <span
                            className={`text-xs ${change !== null ? (change >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-gray-400'}`}
                          >
                            {change !== null ? (
                              <>
                                {change >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                                {Math.abs(change).toFixed(0)}%
                              </>
                            ) : '—'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-800 inline-flex items-center justify-end gap-0.5">
                            {formattedValue}
                            {showComparison && change !== null && (
                              change >= 0 ? <ChevronUp size={14} className="text-green-600" /> : <ChevronDown size={14} className="text-orange-500" />
                            )}
                          </span>
                        )}
                      </span>
                      {/* Desktop: always show value + full evo% */}
                      <span className="hidden md:inline-flex items-center justify-end gap-1 text-xs text-gray-800">
                        {formattedValue}
                        {showComparison && change !== null && (
                          <span className={change >= 0 ? 'text-green-600' : 'text-orange-500'}>
                            {change >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                            {Math.abs(change).toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Expanded Drawer (only for table views) */}
      {!isMapView && (
      <Drawer
        title={
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {title}
              <Tooltip title="Limited to top 200 results for performance">
                <Info size={14} className="text-gray-400 cursor-help" />
              </Tooltip>
            </div>
            {/* Growth toggle - only when comparison is shown */}
            {showComparison && (
              <button
                onClick={() => setShowEvoDetails(!showEvoDetails)}
                className={`p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer ${showEvoDetails ? 'text-[var(--primary)]' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <TrendingUp size={16} />
              </button>
            )}
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
          {columns.map((col, colIndex) => {
            const isFirst = colIndex === 0
            return (
              <button
                key={col.key}
                onClick={() => handleHeaderClick(col.key)}
                className={`text-xs font-medium ${isFirst ? 'text-right' : 'pl-6'} cursor-pointer hover:text-gray-900 flex items-center ${isFirst ? 'justify-end' : ''} gap-0.5 ${isFirst ? 'w-16 md:w-24' : 'w-28 md:w-36'} flex-shrink-0 bg-white md:bg-transparent ${sortBy === col.key ? 'text-gray-900' : 'text-gray-500'}`}
              >
                {col.label}
                {sortBy === col.key ? (
                  sortDirection === 'desc' ? (
                    <ArrowDown size={12} className="text-[var(--primary)]" />
                  ) : (
                    <ArrowUp size={12} className="text-[var(--primary)]" />
                  )
                ) : (
                  <ArrowDown size={12} className="opacity-0" />
                )}
              </button>
            )
          })}
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
                  columns={columns}
                  sortBy={sortBy}
                  maxValue={expandedMaxValue}
                  maxHeatMapValue={expandedMaxHeatMapValue}
                  timescoreReference={timescoreReference}
                  showComparison={showComparison}
                  showEvoDetails={showEvoDetails}
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
  columns: ColumnConfig[]
  sortBy: string
  maxValue: number
  maxHeatMapValue: number
  timescoreReference: number
  showComparison: boolean
  showEvoDetails: boolean
  iconPrefix?: React.ReactNode
  onClick?: () => void
  getChange: (current: number, previous?: number) => number | null
}

function DimensionRow({
  row,
  columns,
  sortBy,
  maxValue,
  maxHeatMapValue,
  timescoreReference,
  showComparison,
  showEvoDetails,
  iconPrefix,
  onClick,
  getChange,
}: DimensionRowProps) {
  const percent = ((row[sortBy] as number) / maxValue) * 100
  const displayValue = row.dimension_value || '(empty)'

  return (
    <div
      onClick={onClick}
      className={`group/row relative flex items-center h-9 px-4 border-b border-transparent hover:border-[var(--primary)] min-w-max md:min-w-0 ${onClick ? 'cursor-pointer' : ''}`}
    >
      {/* Dimension column */}
      <div className="flex-1 h-full">
        <div className="relative h-full flex items-center pl-1.5 gap-2">
          {/* Background bar - contained within scroll area */}
          <div
            className="absolute inset-y-1 left-0 bg-[var(--primary)] opacity-[0.06] rounded pointer-events-none"
            style={{ width: `${percent}%`, minWidth: '0.5rem' }}
          />
          {iconPrefix}
          <Tooltip title={displayValue} placement="topLeft">
            <span className="relative whitespace-nowrap md:truncate block text-xs text-gray-700 group-hover/row:text-gray-900 pr-2">
              {displayValue}
            </span>
          </Tooltip>
        </div>
      </div>

      {/* Metric columns */}
      {columns.map((col, colIndex) => {
        const isFirst = colIndex === 0
        const isLast = colIndex === columns.length - 1
        const hasHeatMap = col.heatMap
        const value = row[col.key] as number
        const prevValue = row[`prev_${col.key}`] as number | undefined
        const change = showComparison ? getChange(value, prevValue) : null
        const formattedValue = col.format === 'currency'
          ? formatCurrency(value, col.currency)
          : formatValue(value, col.format)

        // Sticky positioning: last column at right-0, second-to-last at right-[7rem]
        const stickyClass = isLast
          ? 'sticky right-0 md:static'
          : isFirst && columns.length > 1
            ? 'sticky right-[7rem] md:static'
            : ''

        return (
          <div
            key={col.key}
            className={`${isFirst ? 'text-right w-16 md:w-24 justify-end' : 'w-28 md:w-36 gap-2 pl-6'} flex-shrink-0 flex items-center bg-white md:bg-transparent h-full ${stickyClass}`}
          >
            {hasHeatMap && (
              <span style={getHeatMapStyle(value, maxHeatMapValue, timescoreReference)} />
            )}
            {/* Mobile: toggle between value+caret and evo% */}
            <span className="md:hidden">
              {showEvoDetails && showComparison ? (
                <span
                  className={`text-xs ${change !== null ? (change >= 0 ? 'text-green-600' : 'text-orange-500') : 'text-gray-400'}`}
                >
                  {change !== null ? (
                    <>
                      {change >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                      {Math.abs(change).toFixed(0)}%
                    </>
                  ) : '—'}
                </span>
              ) : (
                <span className="text-xs text-gray-800 inline-flex items-center justify-end gap-0.5">
                  {formattedValue}
                  {showComparison && change !== null && (
                    change >= 0 ? <ChevronUp size={14} className="text-green-600" /> : <ChevronDown size={14} className="text-orange-500" />
                  )}
                </span>
              )}
            </span>
            {/* Desktop: always show value + full evo% */}
            <span className="hidden md:inline-flex items-center justify-end gap-1 text-xs text-gray-800">
              {formattedValue}
              {showComparison && change !== null && (
                <span className={change >= 0 ? 'text-green-600' : 'text-orange-500'}>
                  {change >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                  {Math.abs(change).toFixed(0)}%
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
