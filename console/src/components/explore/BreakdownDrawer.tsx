import { Drawer, Divider, Space, Tag } from 'antd'
import { useQueries } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { BreakdownTableView } from './BreakdownTable'
import { getDimensionLabel } from '../../lib/explore-utils'
import type { ExploreRow } from '../../types/explore'
import type { Filter, DateRange } from '../../types/analytics'
import type { CustomDimensionLabels } from '../../types/workspace'

interface BreakdownDrawerProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  selectedRow: ExploreRow
  breakdownDimensions: string[]
  parentFilters: Filter[]
  dateRange: DateRange
  timezone: string
  minSessions: number
  timescoreReference: number
  customDimensionLabels?: CustomDimensionLabels | null
  dimensions: string[]
}

export function BreakdownDrawer({
  open,
  onClose,
  workspaceId,
  selectedRow,
  breakdownDimensions,
  parentFilters,
  dateRange,
  timezone,
  minSessions,
  timescoreReference,
  customDimensionLabels,
  dimensions,
}: BreakdownDrawerProps) {
  // Get the dimension value for the selected row
  const currentDimension = dimensions[selectedRow.parentDimensionIndex]
  const dimensionValue = selectedRow[currentDimension]
  const displayValue =
    dimensionValue === null
      ? '(not set)'
      : dimensionValue === ''
        ? '(empty)'
        : String(dimensionValue)

  // Parallel queries for all breakdown dimensions
  const breakdownQueries = useQueries({
    queries: breakdownDimensions.map((dimension) => ({
      queryKey: ['breakdown', workspaceId, dimension, parentFilters, dateRange, minSessions],
      queryFn: () =>
        api.analytics.query({
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration', 'bounce_rate', 'max_scroll'],
          dimensions: [dimension],
          filters: parentFilters,
          dateRange,
          timezone,
          order: { sessions: 'desc' },
          limit: 100,
          havingMinSessions: minSessions,
        }),
      staleTime: 60_000, // 1 minute cache
    })),
  })

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <span className="font-medium">{displayValue}</span>
          <span className="text-gray-400">-</span>
          <span className="text-gray-500 font-normal">Breakdown</span>
        </div>
      }
      placement="right"
      width={1000}
      open={open}
      onClose={onClose}
      closeIcon={true}
    >
      {/* Filter Summary */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="text-sm text-gray-600 mb-2">
          <span className="font-medium">Filters:</span>{' '}
          {parentFilters.length === 0 ? (
            <span className="text-gray-400">None</span>
          ) : (
            <Space size={[4, 4]} wrap>
              {parentFilters.map((f, i) => (
                <Tag key={i} className="m-0">
                  {getDimensionLabel(f.dimension, customDimensionLabels)} {f.operator}{' '}
                  {f.values?.join(', ')}
                </Tag>
              ))}
            </Space>
          )}
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
      <div className="grid grid-cols-2 gap-6">
        {breakdownDimensions.map((dimension, index) => (
          <BreakdownTableView
            key={dimension}
            dimension={dimension}
            query={breakdownQueries[index]}
            timescoreReference={timescoreReference}
            customDimensionLabels={customDimensionLabels}
          />
        ))}
      </div>
    </Drawer>
  )
}
