import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import { Table, Button, Empty } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { api } from '../../../../lib/api'
import { DateRangePicker } from '../../../../components/dashboard/DateRangePicker'
import { ComparisonPicker } from '../../../../components/dashboard/ComparisonPicker'
import { BreakdownModal } from '../../../../components/explore/BreakdownModal'
import { GoalsBreakdownDrawer } from '../../../../components/goals/GoalsBreakdownDrawer'
import { formatNumber, formatCurrency } from '../../../../lib/chart-utils'
import type { DatePreset, DateRange } from '../../../../types/analytics'
import type { ComparisonMode } from '../../../../types/dashboard'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/goals')({
  component: Goals,
})

interface GoalRow {
  goal_name: string
  goals: number
  goal_value: number
  goals_prev?: number
  goal_value_prev?: number
  goals_change?: number
  goal_value_change?: number
}

function ChangeIndicator({ value }: { value?: number }) {
  if (value === undefined || isNaN(value)) return null

  const isPositive = value > 0
  const isNegative = value < 0

  return (
    <span
      className={`text-xs flex items-center justify-end w-12 ml-1 ${
        isPositive ? 'text-green-600' : isNegative ? 'text-orange-500' : 'text-gray-500'
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

function Goals() {
  const { workspaceId } = Route.useParams()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  // Date range state
  const [period, setPeriod] = useState<DatePreset | 'custom'>('previous_30_days')
  const [comparison, setComparison] = useState<ComparisonMode>('previous_period')
  const [customStart, setCustomStart] = useState<string | undefined>()
  const [customEnd, setCustomEnd] = useState<string | undefined>()

  // Breakdown modal/drawer state
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [breakdownDimensions, setBreakdownDimensions] = useState<string[]>([])

  const showComparison = comparison !== 'none'

  const dateRange: DateRange = useMemo(() => {
    return period === 'custom' && customStart && customEnd
      ? { start: customStart, end: customEnd }
      : { preset: period as DatePreset }
  }, [period, customStart, customEnd])

  // Query goals list with comparison
  const { data: goalsResponse, isLoading } = useQuery({
    queryKey: ['goals', 'list', workspaceId, dateRange, showComparison],
    queryFn: () =>
      api.analytics.query({
        workspace_id: workspaceId,
        table: 'goals',
        metrics: ['goals', 'goal_value'],
        dimensions: ['goal_name'],
        dateRange,
        ...(showComparison && { compareDateRange: dateRange }),
        timezone: workspace.timezone,
        order: { goals: 'desc' },
        limit: 100,
      }),
    staleTime: 60_000,
  })

  // Process goal data and calculate changes
  const goalsData: GoalRow[] = useMemo(() => {
    // Handle comparison data structure
    let currentData: Record<string, unknown>[] = []
    let previousData: Record<string, unknown>[] = []

    if (showComparison && goalsResponse?.data && typeof goalsResponse.data === 'object' && 'current' in goalsResponse.data) {
      const compData = goalsResponse.data as { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
      currentData = compData.current || []
      previousData = compData.previous || []
    } else {
      currentData = (goalsResponse?.data as Record<string, unknown>[] | undefined) || []
    }

    // Create a map of previous values by goal_name
    const prevMap = new Map<string, { goals: number; goal_value: number }>()
    for (const row of previousData) {
      prevMap.set(row.goal_name as string, {
        goals: row.goals as number,
        goal_value: row.goal_value as number,
      })
    }

    return currentData.map((row) => {
      const goalName = row.goal_name as string
      const goals = row.goals as number
      const goalValue = row.goal_value as number
      const prev = prevMap.get(goalName)

      // Calculate percentage change
      const goalsChange = prev && prev.goals > 0 ? ((goals - prev.goals) / prev.goals) * 100 : undefined
      const goalValueChange = prev && prev.goal_value > 0 ? ((goalValue - prev.goal_value) / prev.goal_value) * 100 : undefined

      return {
        goal_name: goalName,
        goals,
        goal_value: goalValue,
        goals_prev: prev?.goals,
        goal_value_prev: prev?.goal_value,
        goals_change: goalsChange,
        goal_value_change: goalValueChange,
      }
    })
  }, [goalsResponse?.data, showComparison])

  // Handle view click - open dimension selector modal
  const handleView = (goalName: string) => {
    setSelectedGoal(goalName)
    setBreakdownDimensions(['channel_group', 'device']) // Default dimensions
    setIsModalOpen(true)
  }

  // Handle dimension selection confirmed
  const handleDimensionsConfirm = (dims: string[]) => {
    setBreakdownDimensions(dims)
    setIsModalOpen(false)
    setIsDrawerOpen(true)
  }

  const handlePeriodChange = (newPeriod: DatePreset) => {
    setPeriod(newPeriod)
  }

  const handleCustomRangeChange = (start: string, end: string) => {
    setPeriod('custom')
    setCustomStart(start)
    setCustomEnd(end)
  }

  const columns = [
    {
      title: 'Goal',
      dataIndex: 'goal_name',
      key: 'goal_name',
      render: (name: string) => <span className="font-medium">{name}</span>,
    },
    {
      title: 'Count',
      dataIndex: 'goals',
      key: 'goals',
      width: 140,
      align: 'right' as const,
      sorter: (a: GoalRow, b: GoalRow) => a.goals - b.goals,
      render: (v: number, row: GoalRow) => (
        <div className="flex items-center justify-end">
          <span>{formatNumber(v)}</span>
          {showComparison && <ChangeIndicator value={row.goals_change} />}
        </div>
      ),
    },
    {
      title: 'Value',
      dataIndex: 'goal_value',
      key: 'goal_value',
      width: 160,
      align: 'right' as const,
      sorter: (a: GoalRow, b: GoalRow) => a.goal_value - b.goal_value,
      render: (v: number, row: GoalRow) => (
        <div className="flex items-center justify-end">
          {v > 0 ? (
            <>
              <span>{formatCurrency(v, workspace.currency)}</span>
              {showComparison && <ChangeIndicator value={row.goal_value_change} />}
            </>
          ) : (
            <span className="text-gray-400">--</span>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, row: GoalRow) => (
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined className="opacity-70" />}
          onClick={() => handleView(row.goal_name)}
          title="View breakdown"
        />
      ),
    },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker
            period={period as DatePreset}
            timezone={workspace.timezone}
            onPeriodChange={handlePeriodChange}
            onCustomRangeChange={handleCustomRangeChange}
            customStart={customStart}
            customEnd={customEnd}
          />
          <ComparisonPicker value={comparison} onChange={setComparison} />
        </div>
      </div>

      {goalsData.length === 0 && !isLoading ? (
        <Empty
          description="No goals tracked yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-12"
        />
      ) : (
        <Table
          dataSource={goalsData}
          columns={columns}
          rowKey="goal_name"
          pagination={false}
          loading={isLoading}
          size="middle"
        />
      )}

      {/* Dimension Selector Modal */}
      <BreakdownModal
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onSubmit={handleDimensionsConfirm}
        initialDimensions={breakdownDimensions}
        customDimensionLabels={workspace.settings.custom_dimensions}
        title="Select dimensions to analyze"
        submitText="View Breakdown"
      />

      {/* Breakdown Drawer */}
      {selectedGoal && (
        <GoalsBreakdownDrawer
          open={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false)
            setSelectedGoal(null)
          }}
          workspaceId={workspaceId}
          goalName={selectedGoal}
          breakdownDimensions={breakdownDimensions}
          dateRange={dateRange}
          timezone={workspace.timezone}
          currency={workspace.currency}
          customDimensionLabels={workspace.settings.custom_dimensions}
        />
      )}
    </div>
  )
}
