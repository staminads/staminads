import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Tooltip, Empty, Spin } from 'antd'
import { ChevronUp, ChevronDown, Info, ArrowDown, ArrowUp } from 'lucide-react'
import { analyticsQueryOptions } from '../../lib/queries'
import { formatNumber, formatCurrency } from '../../lib/chart-utils'
import { useDashboardContext } from '../../hooks/useDashboardContext'
import type { DatePreset } from '../../types/analytics'

interface GoalsWidgetProps {
  currency: string
}

interface GoalRow {
  goal_name: string
  goals: number
  goal_value: number
  prev_goals?: number
  prev_goal_value?: number
}

type SortKey = 'goals' | 'goal_value'
type SortDirection = 'asc' | 'desc'

export function GoalsWidget({ currency }: GoalsWidgetProps) {
  const { workspaceId, dateRange, compareDateRange, timezone, globalFilters, showComparison } =
    useDashboardContext()
  const [sortBy, setSortBy] = useState<SortKey>('goals')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Build the query for goals table with goal_name dimension
  const goalsQuery = useMemo(() => {
    const query: Record<string, unknown> = {
      workspace_id: workspaceId,
      table: 'goals',
      metrics: ['goals', 'goal_value'],
      dimensions: ['goal_name'],
      order: { [sortBy]: sortDirection },
      limit: 10,
      filters: globalFilters.length > 0 ? globalFilters : undefined,
      timezone,
    }

    // Handle date range
    if ('preset' in dateRange) {
      query.dateRange = { preset: dateRange.preset }
    } else {
      query.dateRange = { start: dateRange.start, end: dateRange.end }
    }

    // Handle comparison date range
    if (showComparison && compareDateRange) {
      if ('preset' in compareDateRange) {
        query.compareDateRange = { preset: compareDateRange.preset }
      } else {
        query.compareDateRange = { start: compareDateRange.start, end: compareDateRange.end }
      }
    }

    return query
  }, [workspaceId, dateRange, compareDateRange, timezone, globalFilters, showComparison, sortBy, sortDirection])

  const { data: response, isFetching } = useQuery({
    ...analyticsQueryOptions(goalsQuery as { workspace_id: string; metrics: string[]; dateRange: { preset: DatePreset } }),
    placeholderData: keepPreviousData,
  })

  // Extract rows from response
  const rows: GoalRow[] = useMemo(() => {
    if (!response?.data) {
      return []
    }

    // Check if response has comparison data structure
    const hasComparison =
      typeof response.data === 'object' &&
      'current' in response.data &&
      Array.isArray((response.data as { current: unknown[] }).current)

    if (hasComparison) {
      const { current, previous } = response.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }

      // Create a map of previous values by goal_name
      const prevMap = new Map<string, { goals: number; goal_value: number }>()
      if (previous) {
        for (const row of previous) {
          prevMap.set(String(row.goal_name), {
            goals: Number(row.goals) || 0,
            goal_value: Number(row.goal_value) || 0,
          })
        }
      }

      return current.map((row) => {
        const goalName = String(row.goal_name)
        const prev = prevMap.get(goalName)
        return {
          goal_name: goalName,
          goals: Number(row.goals) || 0,
          goal_value: Number(row.goal_value) || 0,
          prev_goals: prev?.goals,
          prev_goal_value: prev?.goal_value,
        }
      })
    }

    // Non-comparison data structure
    const data = response.data as Record<string, unknown>[]
    if (!Array.isArray(data)) {
      return []
    }

    return data.map((row) => ({
      goal_name: String(row.goal_name),
      goals: Number(row.goals) || 0,
      goal_value: Number(row.goal_value) || 0,
    }))
  }, [response])

  const getChange = (current: number, previous?: number) => {
    if (previous === undefined || previous === 0) return null
    return ((current - previous) / previous) * 100
  }

  const handleHeaderClick = (key: SortKey) => {
    if (sortBy === key) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(key)
      setSortDirection('desc')
    }
  }

  const loading = isFetching && !response
  const maxGoals = rows[0]?.goals ?? 1

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Title */}
      <div className="px-4 pt-4 pb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          Goals
          <Tooltip title="Track goal conversions and their total value">
            <Info size={14} className="text-gray-400 cursor-help" />
          </Tooltip>
        </h3>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spin />
        </div>
      ) : rows.length === 0 ? (
        <Empty
          description="No goals recorded"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <div className="flex">
          {/* Goal Name Column */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center h-[46px] px-4 border-b border-gray-200">
              <span className="text-xs font-medium text-gray-600">Goal</span>
            </div>
            {rows.map((row) => {
              const percent = (row.goals / maxGoals) * 100
              return (
                <div
                  key={row.goal_name}
                  className="h-9 flex items-center px-4 border-b border-transparent relative"
                >
                  <div
                    className="absolute inset-y-1 left-1.5 bg-[var(--primary)] opacity-[0.06] rounded pointer-events-none"
                    style={{ width: `${percent}%`, minWidth: '0.5rem' }}
                  />
                  <span className="relative truncate text-xs text-gray-700">
                    {row.goal_name || '(empty)'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Count Column */}
          <div className="w-20 flex-shrink-0">
            <div className="flex items-center justify-end h-[46px] pr-4 border-b border-gray-200">
              <button
                onClick={() => handleHeaderClick('goals')}
                className={`text-xs font-medium cursor-pointer hover:text-gray-900 flex items-center gap-0.5 ${
                  sortBy === 'goals' ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                Count
                {sortBy === 'goals' ? (
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
            {rows.map((row) => {
              const change = showComparison ? getChange(row.goals, row.prev_goals) : null
              return (
                <div
                  key={row.goal_name}
                  className="h-9 flex items-center justify-end pr-4 border-b border-transparent"
                >
                  <span className="text-xs text-gray-800 flex items-center gap-1">
                    {formatNumber(row.goals)}
                    {showComparison && change !== null && (
                      <span className={change >= 0 ? 'text-green-600' : 'text-orange-500'}>
                        {change >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Value Column */}
          <div className="w-24 flex-shrink-0">
            <div className="flex items-center justify-end h-[46px] pr-4 border-b border-gray-200">
              <button
                onClick={() => handleHeaderClick('goal_value')}
                className={`text-xs font-medium cursor-pointer hover:text-gray-900 flex items-center gap-0.5 ${
                  sortBy === 'goal_value' ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                Value
                {sortBy === 'goal_value' ? (
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
            {rows.map((row) => {
              const change = showComparison ? getChange(row.goal_value, row.prev_goal_value) : null
              return (
                <div
                  key={row.goal_name}
                  className="h-9 flex items-center justify-end pr-4 border-b border-transparent"
                >
                  <span className="text-xs text-gray-800 flex items-center gap-1">
                    {formatCurrency(row.goal_value, currency)}
                    {showComparison && change !== null && (
                      <span className={change >= 0 ? 'text-green-600' : 'text-orange-500'}>
                        {change >= 0 ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
