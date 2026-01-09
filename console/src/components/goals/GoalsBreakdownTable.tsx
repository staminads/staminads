import { Table, Spin, Alert, Progress } from 'antd'
import type { UseQueryResult } from '@tanstack/react-query'
import { getDimensionLabel } from '../../lib/explore-utils'
import { DaysOfWeek } from '../../lib/dictionaries'
import { formatNumber, formatCurrency } from '../../lib/chart-utils'
import type { AnalyticsResponse } from '../../types/analytics'
import type { CustomDimensionLabels } from '../../types/workspace'

interface GoalsBreakdownTableProps {
  dimension: string
  query: UseQueryResult<AnalyticsResponse, Error>
  currency: string
  customDimensionLabels?: CustomDimensionLabels | null
}

export function GoalsBreakdownTable({
  dimension,
  query,
  currency,
  customDimensionLabels,
}: GoalsBreakdownTableProps) {
  const { data, isLoading, error } = query

  // Handle comparison data structure
  const rows = Array.isArray(data?.data)
    ? data.data
    : (data?.data as { current?: unknown[] })?.current || []

  // Calculate total for percentage
  const totalGoals = (rows as Record<string, unknown>[]).reduce(
    (sum, row) => sum + ((row.goals as number) || 0),
    0
  )

  const columns = [
    {
      title: getDimensionLabel(dimension, customDimensionLabels),
      dataIndex: dimension,
      ellipsis: true,
      render: (value: unknown) => {
        if (value === null) return <span className="text-gray-400">(not set)</span>
        if (value === '') return <span className="text-gray-400">(empty)</span>
        if (dimension === 'day_of_week' && typeof value === 'number') {
          return DaysOfWeek[value] ?? String(value)
        }
        return String(value)
      },
    },
    {
      title: 'Goals',
      dataIndex: 'goals',
      width: 60,
      align: 'right' as const,
      render: (v: number) => formatNumber(v),
    },
    {
      title: '%',
      dataIndex: 'goals',
      key: 'percentage',
      width: 100,
      render: (v: number) => {
        const percentage = totalGoals > 0 ? (v / totalGoals) * 100 : 0
        return (
          <div className="flex items-center gap-1">
            <Progress
              percent={percentage}
              showInfo={false}
              size="small"
              strokeColor="var(--primary)"
              className="flex-1"
            />
            <span className="text-xs text-gray-500 w-8 text-right">{percentage.toFixed(0)}%</span>
          </div>
        )
      },
    },
    {
      title: 'Value',
      dataIndex: 'goal_value',
      width: 70,
      align: 'right' as const,
      render: (v: number) =>
        v > 0 ? (
          formatCurrency(v, currency)
        ) : (
          <span className="text-gray-400">--</span>
        ),
    },
  ]

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded text-red-600 text-sm">
        Error loading breakdown data
      </div>
    )
  }

  return (
    <div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spin size="small" />
        </div>
      ) : rows.length === 0 ? (
        <Alert message="No data for this dimension" type="info" className="text-sm" />
      ) : (
        <Table
          dataSource={rows as Record<string, unknown>[]}
          columns={columns}
          rowKey={(row) => String(row[dimension])}
          pagination={false}
          size="small"
          className="breakdown-table"
        />
      )}
    </div>
  )
}
