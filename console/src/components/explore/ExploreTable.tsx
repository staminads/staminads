import { useMemo, useCallback } from 'react'
import { Table, Empty, Spin, Tooltip, Button } from 'antd'
import { SquarePlus, SquareMinus, Loader2, ChevronUp, ChevronDown, TriangleAlert } from 'lucide-react'
import { EyeOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { HeatMapCell } from './HeatMapCell'
import { getDimensionLabel, canExpandRow } from '../../lib/explore-utils'
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
        title: 'Avg. Scroll',
        dataIndex: 'max_scroll',
        key: 'max_scroll',
        align: 'right',
        render: (value, record) => (
          <div className="flex items-center justify-end">
            <span>{formatPercentage(value)}</span>
            {showComparison && <ChangeIndicator value={record.max_scroll_change} />}
          </div>
        ),
        sorter: (a, b) => a.max_scroll - b.max_scroll,
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
    <Table<ExploreRow>
      columns={columns}
      dataSource={data}
      rowKey="key"
      loading={loading}
      pagination={false}
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
  )
}
