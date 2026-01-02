import { Table, Tooltip } from 'antd'
import type { UseQueryResult } from '@tanstack/react-query'
import { HeatMapCell } from './HeatMapCell'
import { getDimensionLabel } from '../../lib/explore-utils'
import { formatNumber } from '../../lib/chart-utils'
import type { AnalyticsResponse } from '../../types/analytics'
import type { CustomDimensionLabels } from '../../types/workspace'

interface BreakdownTableViewProps {
  dimension: string
  query: UseQueryResult<AnalyticsResponse, Error>
  timescoreReference: number
  customDimensionLabels?: CustomDimensionLabels | null
}

export function BreakdownTableView({
  dimension,
  query,
  timescoreReference,
  customDimensionLabels,
}: BreakdownTableViewProps) {
  const { data, isLoading, error } = query

  // Handle comparison data structure
  const rows = Array.isArray(data?.data)
    ? data.data
    : (data?.data as { current?: unknown[] })?.current || []

  // Find max median_duration for heat map scaling (start from 0, let color function handle reference)
  const maxMedian = (rows as Record<string, unknown>[]).reduce(
    (max, row) => Math.max(max, (row.median_duration as number) || 0),
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
        return String(value)
      },
    },
    {
      title: 'Sessions',
      dataIndex: 'sessions',
      width: 80,
      align: 'right' as const,
      render: (v: number) => formatNumber(v),
    },
    {
      title: (
        <Tooltip title="Green = meets reference, Cyan = exceeds reference">
          <span className="cursor-help border-b border-dotted border-gray-400">TimeScore</span>
        </Tooltip>
      ),
      dataIndex: 'median_duration',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <HeatMapCell value={v} bestValue={maxMedian} referenceValue={timescoreReference} />,
    },
    {
      title: 'Bounce',
      dataIndex: 'bounce_rate',
      width: 70,
      align: 'right' as const,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
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
      <h4 className="font-medium text-gray-700 mb-2">
        By {getDimensionLabel(dimension, customDimensionLabels)}
      </h4>
      <Table
        columns={columns}
        dataSource={rows as Record<string, unknown>[]}
        loading={isLoading}
        pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
        size="small"
        rowKey={(row) => String(row[dimension] ?? 'null')}
      />
    </div>
  )
}
