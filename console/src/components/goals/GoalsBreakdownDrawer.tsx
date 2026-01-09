import { Drawer, Divider, Space, Tag } from 'antd'
import { useQueries } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { GoalsBreakdownTable } from './GoalsBreakdownTable'
import { getDimensionLabel } from '../../lib/explore-utils'
import type { DateRange } from '../../types/analytics'
import type { CustomDimensionLabels } from '../../types/workspace'

interface GoalsBreakdownDrawerProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  goalName: string
  breakdownDimensions: string[]
  dateRange: DateRange
  timezone: string
  currency: string
  customDimensionLabels?: CustomDimensionLabels | null
}

export function GoalsBreakdownDrawer({
  open,
  onClose,
  workspaceId,
  goalName,
  breakdownDimensions,
  dateRange,
  timezone,
  currency,
  customDimensionLabels,
}: GoalsBreakdownDrawerProps) {
  // Parallel queries for all breakdown dimensions
  const breakdownQueries = useQueries({
    queries: breakdownDimensions.map((dimension) => ({
      queryKey: ['goals', 'breakdown', workspaceId, goalName, dimension, dateRange],
      queryFn: () =>
        api.analytics.query({
          workspace_id: workspaceId,
          table: 'goals',
          metrics: ['goals', 'goal_value'],
          dimensions: [dimension],
          filters: [{ dimension: 'goal_name', operator: 'equals', values: [goalName] }],
          dateRange,
          timezone,
          order: { goals: 'desc' },
          limit: 100,
        }),
      staleTime: 60_000, // 1 minute cache
      enabled: open, // Only fetch when drawer is open
    })),
  })

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <span className="font-medium">{goalName}</span>
          <span className="text-gray-400">-</span>
          <span className="text-gray-500 font-normal">Contributors</span>
        </div>
      }
      placement="right"
      width="100%"
      open={open}
      onClose={onClose}
      closeIcon={true}
      styles={{ body: { background: 'var(--background)' } }}
    >
      {/* Filter Summary */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="text-sm text-gray-600 mb-2">
          <span className="font-medium">Goal:</span>{' '}
          <Tag color="green" className="m-0">
            {goalName}
          </Tag>
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">Breaking down by:</span>{' '}
          <Space size={[4, 4]} wrap>
            {breakdownDimensions.map((d) => (
              <Tag key={d} color="blue" className="m-0">
                {getDimensionLabel(d, customDimensionLabels)}
              </Tag>
            ))}
          </Space>
        </div>
      </div>

      <Divider className="my-4" />

      {/* Breakdown Tables Grid - queries run in parallel */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {breakdownDimensions.map((dimension, index) => (
          <GoalsBreakdownTable
            key={dimension}
            dimension={dimension}
            query={breakdownQueries[index]}
            currency={currency}
            customDimensionLabels={customDimensionLabels}
          />
        ))}
      </div>
    </Drawer>
  )
}
