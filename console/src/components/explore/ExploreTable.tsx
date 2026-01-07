import { useMemo, useCallback, useState } from 'react'
import { Table, Empty, Spin, Tooltip, Button } from 'antd'
import { SquarePlus, SquareMinus, Loader2, ChevronUp, ChevronDown, TriangleAlert } from 'lucide-react'
import { EyeOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { HeatMapCell } from './HeatMapCell'
import { getDimensionLabel, canExpandRow, getHeatMapColor } from '../../lib/explore-utils'
import { DaysOfWeek } from '../../lib/dictionaries'
import { formatNumber } from '../../lib/chart-utils'
import type { ExploreRow, ExploreTotals } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'

interface ExploreTableProps {
  data: ExploreRow[]
  dimensions: string[]
  expandedRowKeys: React.Key[]
  onExpand: (expanded: boolean, record: ExploreRow) => void
  onExpandedRowsChange: (expandedRows: React.Key[]) => void
  loadingRows: Set<string>
  maxMedianDuration: number
  timescoreReference?: number
  showComparison: boolean
  loading?: boolean
  customDimensionLabels?: CustomDimensionLabels | null
  totals?: ExploreTotals
  onBreakdownClick?: (row: ExploreRow) => void
  onBreakdownHover?: (row: ExploreRow) => void
  minSessions?: number
  maxDimensionValues?: Record<string, string | number | null>
}

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function ChangeIndicator({
  value,
  invertColors = false
}: {
  value?: number
  invertColors?: boolean
}) {
  if (value === undefined) return null

  const isPositive = value > 0
  const isNegative = value < 0

  // For metrics where lower is better (like bounce rate), invert the colors
  const positiveColor = invertColors ? 'text-orange-500' : 'text-green-600'
  const negativeColor = invertColors ? 'text-green-600' : 'text-orange-500'

  return (
    <span
      className={`text-xs flex items-center justify-end w-12 ml-1 ${
        isPositive ? positiveColor : isNegative ? negativeColor : 'text-gray-500'
      }`}
    >
      {isPositive ? (
        <ChevronUp size={12} className="mr-0.5" />
      ) : isNegative ? (
        <ChevronDown size={12} className="mr-0.5" />
      ) : null}
      {Math.abs(value).toFixed(0)}%
    </span>
  )
}

function MobileMetricRow({ label, value, change, invertColors, showComparison }: {
  label: string
  value: string | number
  change?: number
  invertColors?: boolean
  showComparison: boolean
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 text-sm">{label}</span>
      <div className="flex items-center">
        <span className="font-medium">{value}</span>
        {showComparison && <ChangeIndicator value={change} invertColors={invertColors} />}
      </div>
    </div>
  )
}

function MobileExploreCard({
  record,
  dimensions,
  depth,
  isExpanded,
  onToggle,
  onDrillDown,
  isLoading,
  showComparison,
  customDimensionLabels,
  maxMedianDuration,
  timescoreReference,
}: {
  record: ExploreRow
  dimensions: string[]
  depth: number
  isExpanded: boolean
  onToggle: () => void
  onDrillDown: () => void
  isLoading: boolean
  showComparison: boolean
  customDimensionLabels?: CustomDimensionLabels | null
  maxMedianDuration: number
  timescoreReference: number
}) {
  const currentDim = dimensions[record.parentDimensionIndex] || dimensions[0]
  const rawValue = record[currentDim]
  const displayValue = rawValue === null || rawValue === '' || rawValue === undefined
    ? '(empty)'
    : currentDim === 'day_of_week' && typeof rawValue === 'number'
      ? DaysOfWeek[rawValue] ?? String(rawValue)
      : String(rawValue)
  const canDrillDown = canExpandRow(record, dimensions)
  const heatColor = getHeatMapColor(record.median_duration, maxMedianDuration, timescoreReference)

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-4 mb-3"
      style={{ marginLeft: depth * 16 }}
    >
      {/* Header row - tappable */}
      <div className="flex items-center justify-between cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-400">{getDimensionLabel(currentDim, customDimensionLabels)}</div>
          <div className={`font-medium truncate ${rawValue === null || rawValue === '' ? 'text-gray-400 italic' : ''}`}>
            {displayValue}
          </div>
        </div>
        {isLoading ? (
          <Loader2 size={16} className="animate-spin text-gray-400 ml-2" />
        ) : (
          <ChevronDown size={16} className={`text-gray-400 ml-2 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      {/* Summary metrics (always visible) */}
      <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
        <span>{formatNumber(record.sessions)}</span>
        <span className="text-gray-300">•</span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: heatColor }}
          />
          {formatDuration(record.median_duration)}
        </span>
        <span className="text-gray-300">•</span>
        <span>{record.bounce_rate.toFixed(0)}%</span>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
          <MobileMetricRow label="Sessions" value={formatNumber(record.sessions)} change={record.sessions_change} showComparison={showComparison} />
          <div className="flex justify-between items-center">
            <span className="text-gray-500 text-sm">TimeScore</span>
            <div className="flex items-center">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1"
                style={{ backgroundColor: heatColor }}
              />
              <span className="font-medium">{formatDuration(record.median_duration)}</span>
              {showComparison && <ChangeIndicator value={record.median_duration_change} />}
            </div>
          </div>
          <MobileMetricRow label="Bounce Rate" value={`${record.bounce_rate.toFixed(1)}%`} change={record.bounce_rate_change} invertColors showComparison={showComparison} />
          <MobileMetricRow label="Scroll Depth" value={`${record.median_scroll.toFixed(1)}%`} change={record.median_scroll_change} showComparison={showComparison} />

          {canDrillDown && !record.childrenLoaded && (
            <Button type="primary" ghost block size="small" className="mt-2" onClick={(e) => { e.stopPropagation(); onDrillDown(); }}>
              Drill Down
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function ExploreTable({
  data,
  dimensions,
  expandedRowKeys,
  onExpand,
  onExpandedRowsChange,
  loadingRows,
  maxMedianDuration,
  timescoreReference,
  showComparison,
  loading = false,
  customDimensionLabels,
  totals,
  onBreakdownClick,
  onBreakdownHover,
  minSessions,
  maxDimensionValues
}: ExploreTableProps) {
  // Check if a row matches the best TimeScore dimension values
  // Only checks dimensions that exist in the row (for hierarchical matching)
  const isWinningRow = useCallback((record: ExploreRow): boolean => {
    if (!maxDimensionValues || Object.keys(maxDimensionValues).length === 0) {
      return false
    }

    // Get dimensions this row has values for (based on its level in hierarchy)
    const rowDimensions = dimensions.slice(0, (record.parentDimensionIndex ?? 0) + 1)
    if (rowDimensions.length === 0) return false

    // Check if all dimensions this row has match the winning values
    return rowDimensions.every((dim) => {
      if (!(dim in maxDimensionValues)) return true // Dimension not in winning set
      const rowValue = record[dim]
      const winningValue = maxDimensionValues[dim]
      // Handle null/empty comparisons
      if (winningValue === null || winningValue === '') {
        return rowValue === null || rowValue === '' || rowValue === undefined
      }
      return rowValue === winningValue
    })
  }, [maxDimensionValues, dimensions])

  // Mobile card state
  const [mobileExpandedKeys, setMobileExpandedKeys] = useState<Set<string>>(new Set())

  const toggleMobileExpand = useCallback((key: string) => {
    setMobileExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const renderMobileCards = useMemo(() => {
    const render = (rows: ExploreRow[], depth = 0): React.ReactNode => {
      return rows.map(record => (
        <div key={record.key}>
          <MobileExploreCard
            record={record}
            dimensions={dimensions}
            depth={depth}
            isExpanded={mobileExpandedKeys.has(record.key)}
            onToggle={() => toggleMobileExpand(record.key)}
            onDrillDown={() => onExpand(true, record)}
            isLoading={loadingRows.has(record.key)}
            showComparison={showComparison}
            customDimensionLabels={customDimensionLabels}
            maxMedianDuration={maxMedianDuration}
            timescoreReference={timescoreReference ?? 0}
          />
          {/* Render children if loaded */}
          {record.children && record.children.length > 0 && (
            render(record.children, depth + 1)
          )}
        </div>
      ))
    }
    return render
  }, [dimensions, mobileExpandedKeys, toggleMobileExpand, onExpand, loadingRows, showComparison, customDimensionLabels, maxMedianDuration, timescoreReference])

  const columns: ColumnsType<ExploreRow> = useMemo(() => {
    // Get the current dimension being displayed (the last one that has data)
    const getCurrentDimensionForRow = (row: ExploreRow): string => {
      return dimensions[row.parentDimensionIndex] || dimensions[0]
    }

    const cols: ColumnsType<ExploreRow> = [
      {
        title: 'Dimension',
        dataIndex: 'dimension',
        key: 'dimension',
        render: (_, record) => {
          const currentDim = getCurrentDimensionForRow(record)
          const value = record[currentDim]
          let displayValue: string
          if (value === null || value === '' || value === undefined) {
            displayValue = '(empty)'
          } else if (currentDim === 'day_of_week' && typeof value === 'number') {
            displayValue = DaysOfWeek[value] ?? String(value)
          } else {
            displayValue = String(value)
          }

          return (
            <span className="whitespace-nowrap">
              <span className="text-xs text-gray-400">
                {getDimensionLabel(currentDim, customDimensionLabels)}:
              </span>
              <span
                className={`ml-1 ${value === null || value === '' || value === undefined ? 'text-gray-400 italic' : 'font-medium'}`}
              >
                {displayValue}
              </span>
            </span>
          )
        },
        width: 300
      },
      {
        title: 'Sessions',
        dataIndex: 'sessions',
        key: 'sessions',
        align: 'right',
        render: (value, record) => {
          // Only show percentage for top-level rows (parentDimensionIndex === 0)
          const isTopLevel = record.parentDimensionIndex === 0
          const showPercentage = isTopLevel && totals && totals.sessions > 0
          const percentage = showPercentage ? (value / totals.sessions) * 100 : 0

          return (
            <div className="flex items-center justify-end">
              <span>{formatNumber(value)}</span>
              {showPercentage && (
                <span className="ml-1 text-gray-400 text-xs">({percentage.toFixed(1)}%)</span>
              )}
              {showComparison && <ChangeIndicator value={record.sessions_change} />}
            </div>
          )
        },
        sorter: (a, b) => a.sessions - b.sessions,
        defaultSortOrder: 'descend',
        width: 140
      },
      {
        title: (
          <Tooltip title="Median session duration. Green = meets reference, Cyan = exceeds reference (exceptional engagement).">
            <span className="cursor-help border-b border-dotted border-gray-400">TimeScore</span>
          </Tooltip>
        ),
        dataIndex: 'median_duration',
        key: 'median_duration',
        align: 'right',
        render: (value, record) => (
          <HeatMapCell
            value={value}
            bestValue={maxMedianDuration}
            referenceValue={timescoreReference}
            previousValue={record.median_duration_prev}
            changePercent={record.median_duration_change}
            showComparison={showComparison}
          />
        ),
        sorter: (a, b) => a.median_duration - b.median_duration,
        width: 150
      },
      {
        title: 'Bounce Rate',
        dataIndex: 'bounce_rate',
        key: 'bounce_rate',
        align: 'right',
        render: (value, record) => (
          <div className="flex items-center justify-end">
            <span>{formatPercentage(value)}</span>
            {showComparison && <ChangeIndicator value={record.bounce_rate_change} invertColors />}
          </div>
        ),
        sorter: (a, b) => a.bounce_rate - b.bounce_rate,
        width: 120
      },
      {
        title: 'Median Scroll Depth',
        dataIndex: 'median_scroll',
        key: 'median_scroll',
        align: 'right',
        render: (value, record) => (
          <div className="flex items-center justify-end">
            <span>{formatPercentage(value)}</span>
            {showComparison && <ChangeIndicator value={record.median_scroll_change} />}
          </div>
        ),
        sorter: (a, b) => a.median_scroll - b.median_scroll,
        width: 120
      }
    ]

    // Add actions column if handlers provided
    if (onBreakdownClick) {
      cols.push({
        title: '',
        key: 'actions',
        width: 48,
        align: 'right',
        // fixed: 'right',
        onCell: () => ({ style: { verticalAlign: 'middle', padding: '8px' } }),
        render: (_: unknown, record: ExploreRow) => (
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            className="mr-2"
            onClick={(e) => {
              e.stopPropagation()
              onBreakdownClick(record)
            }}
            onMouseEnter={() => onBreakdownHover?.(record)}
            title="View breakdown"
          />
        )
      })
    }

    return cols
  }, [
    dimensions,
    maxMedianDuration,
    timescoreReference,
    showComparison,
    customDimensionLabels,
    totals,
    onBreakdownClick,
    onBreakdownHover
  ])

  if (dimensions.length === 0) {
    return (
      <Empty
        description="Select dimensions to start exploring"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        className="py-12"
      />
    )
  }

  return (
    <>
      {/* Mobile: Card view */}
      <div className="md:hidden">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-lg border p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <Empty description="No data found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          renderMobileCards(data)
        )}
      </div>

      {/* Desktop: Table view */}
      <div className="hidden md:block">
        <Table<ExploreRow>
          columns={columns}
          dataSource={data}
          rowKey="key"
          loading={loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          rowClassName={(record) => isWinningRow(record) ? 'best-timescore-row' : ''}
          expandable={{
            expandedRowKeys,
            expandRowByClick: true,
            onExpand,
            onExpandedRowsChange: (keys) => onExpandedRowsChange(keys as React.Key[]),
            rowExpandable: (record) => canExpandRow(record, dimensions),
            expandIcon: ({ expanded, record }) => {
              if (!canExpandRow(record, dimensions)) {
                return <span className="w-4" />
              }

              const isLoading = loadingRows.has(record.key)

              if (isLoading) {
                return <Loader2 size={14} className="mr-2 animate-spin text-gray-400" />
              }

              // Show warning icon if children were filtered by min sessions
              if (expanded && record.childrenFilteredByMinSessions) {
                return (
                  <Tooltip title={`All sub-items have fewer than ${minSessions} sessions. Lower the threshold to see them.`}>
                    <span className="mr-2 text-amber-500 cursor-help">
                      <TriangleAlert size={14} />
                    </span>
                  </Tooltip>
                )
              }

              return (
                <span className="mr-2 text-gray-500">
                  {expanded ? <SquareMinus size={14} /> : <SquarePlus size={14} />}
                </span>
              )
            },
            childrenColumnName: 'children'
          }}
          locale={{
            emptyText: loading ? (
              <Spin tip="Loading..." />
            ) : (
              <Empty description="No data found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )
          }}
        />
      </div>
    </>
  )
}
