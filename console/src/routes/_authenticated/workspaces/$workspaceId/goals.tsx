import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import { Empty, Skeleton } from 'antd'
import dayjs from 'dayjs'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { api } from '../../../../lib/api'
import { DateRangePicker } from '../../../../components/dashboard/DateRangePicker'
import { ComparisonPicker } from '../../../../components/dashboard/ComparisonPicker'
import { GoalDashboardDrawer } from '../../../../components/goals/GoalDashboardDrawer'
import { GoalCard } from '../../../../components/goals/GoalCard'
import { determineGranularity } from '../../../../lib/chart-utils'
import { determineGranularityForRange, computeDateRange } from '../../../../lib/date-utils'
import type { DatePreset, DateRange, Granularity } from '../../../../types/analytics'
import type { ComparisonMode, ChartDataPoint } from '../../../../types/dashboard'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/goals')({
  component: Goals,
})

interface GoalMetricData {
  current: number
  previous?: number
  change?: number
  chartData: ChartDataPoint[]
  chartDataPrev: ChartDataPoint[]
}

interface GoalRow {
  goal_name: string
  metrics: {
    goals: GoalMetricData
    sum_goal_value: GoalMetricData
    median_goal_value: GoalMetricData
  }
}

function Goals() {
  const { workspaceId } = Route.useParams()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  // Date range state
  const [period, setPeriod] = useState<DatePreset | 'custom'>('previous_30_days')
  const [comparison, setComparison] = useState<ComparisonMode>('previous_period')
  const [customStart, setCustomStart] = useState<string | undefined>()
  const [customEnd, setCustomEnd] = useState<string | undefined>()

  // Drawer state
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const showComparison = comparison !== 'none'

  const dateRange: DateRange = useMemo(() => {
    return period === 'custom' && customStart && customEnd
      ? { start: customStart, end: customEnd }
      : { preset: period as DatePreset }
  }, [period, customStart, customEnd])

  // Determine granularity based on date range
  const granularity = useMemo<Granularity>(() => {
    if ('preset' in dateRange && dateRange.preset) {
      return determineGranularity(dateRange.preset as DatePreset)
    }
    if ('start' in dateRange && 'end' in dateRange && dateRange.start && dateRange.end) {
      const computed = computeDateRange('custom', workspace.timezone, { start: dateRange.start, end: dateRange.end })
      return determineGranularityForRange(computed.start, computed.end)
    }
    return 'day'
  }, [dateRange, workspace.timezone])

  // Filter annotations by date range
  const filteredAnnotations = useMemo(() => {
    const annotations = workspace.settings.annotations || []
    if (annotations.length === 0) return []

    const resolvedRange = computeDateRange(
      period as DatePreset,
      workspace.timezone,
      period === 'custom' && customStart && customEnd
        ? { start: customStart, end: customEnd }
        : undefined
    )

    return annotations.filter(annotation => {
      const annotationDate = dayjs(annotation.date)
      return !annotationDate.isBefore(resolvedRange.start, 'day')
          && !annotationDate.isAfter(resolvedRange.end, 'day')
    })
  }, [workspace.settings.annotations, period, workspace.timezone, customStart, customEnd])

  // Query goals summary with comparison
  const { data: goalsResponse, isLoading: summaryLoading } = useQuery({
    queryKey: ['goals', 'summary', workspaceId, dateRange, showComparison],
    queryFn: () =>
      api.analytics.query({
        workspace_id: workspaceId,
        table: 'goals',
        metrics: ['goals', 'sum_goal_value', 'median_goal_value'],
        dimensions: ['goal_name'],
        dateRange,
        ...(showComparison && { compareDateRange: dateRange }),
        timezone: workspace.timezone,
        order: { goals: 'desc' },
        limit: 100,
      }),
    staleTime: 60_000,
  })

  // Query time-series data for charts
  const { data: timeSeriesResponse, isLoading: timeSeriesLoading } = useQuery({
    queryKey: ['goals', 'timeseries', workspaceId, dateRange, showComparison, granularity],
    queryFn: () =>
      api.analytics.query({
        workspace_id: workspaceId,
        table: 'goals',
        metrics: ['goals', 'sum_goal_value', 'median_goal_value'],
        dimensions: ['goal_name'],
        dateRange: { ...dateRange, granularity },
        ...(showComparison && { compareDateRange: { ...dateRange, granularity } }),
        timezone: workspace.timezone,
      }),
    staleTime: 60_000,
  })

  const isLoading = summaryLoading || timeSeriesLoading

  // Get date column based on granularity
  const getDateColumn = (g: Granularity): string => {
    const columns: Record<Granularity, string> = {
      hour: 'date_hour',
      day: 'date_day',
      week: 'date_week',
      month: 'date_month',
      year: 'date_year',
    }
    return columns[g]
  }

  // Process goal data and calculate changes
  const goalsData: GoalRow[] = useMemo(() => {
    // Handle summary data structure
    let summaryCurrentData: Record<string, unknown>[] = []
    let summaryPreviousData: Record<string, unknown>[] = []

    if (showComparison && goalsResponse?.data && typeof goalsResponse.data === 'object' && 'current' in goalsResponse.data) {
      const compData = goalsResponse.data as { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
      summaryCurrentData = compData.current || []
      summaryPreviousData = compData.previous || []
    } else {
      summaryCurrentData = (goalsResponse?.data as Record<string, unknown>[] | undefined) || []
    }

    // Handle time-series data structure
    let tsCurrentData: Record<string, unknown>[] = []
    let tsPreviousData: Record<string, unknown>[] = []

    if (showComparison && timeSeriesResponse?.data && typeof timeSeriesResponse.data === 'object' && 'current' in timeSeriesResponse.data) {
      const compData = timeSeriesResponse.data as { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
      tsCurrentData = compData.current || []
      tsPreviousData = compData.previous || []
    } else {
      tsCurrentData = (timeSeriesResponse?.data as Record<string, unknown>[] | undefined) || []
    }

    // Create maps for previous summary values by goal_name
    const summaryPrevMap = new Map<string, { goals: number; sum_goal_value: number; median_goal_value: number }>()
    for (const row of summaryPreviousData) {
      summaryPrevMap.set(row.goal_name as string, {
        goals: row.goals as number,
        sum_goal_value: row.sum_goal_value as number,
        median_goal_value: row.median_goal_value as number,
      })
    }

    // Group time-series data by goal_name
    const dateColumn = getDateColumn(granularity)
    const tsCurrentByGoal = new Map<string, ChartDataPoint[]>()
    const tsPreviousByGoal = new Map<string, ChartDataPoint[]>()

    for (const row of tsCurrentData) {
      const goalName = row.goal_name as string
      if (!tsCurrentByGoal.has(goalName)) {
        tsCurrentByGoal.set(goalName, [])
      }
      tsCurrentByGoal.get(goalName)!.push({
        timestamp: row[dateColumn] as string,
        value: row.goals as number,
        // Store all metrics in a single pass
        sum_goal_value: row.sum_goal_value as number,
        median_goal_value: row.median_goal_value as number,
      } as ChartDataPoint & { sum_goal_value: number; median_goal_value: number })
    }

    for (const row of tsPreviousData) {
      const goalName = row.goal_name as string
      if (!tsPreviousByGoal.has(goalName)) {
        tsPreviousByGoal.set(goalName, [])
      }
      tsPreviousByGoal.get(goalName)!.push({
        timestamp: row[dateColumn] as string,
        value: row.goals as number,
        sum_goal_value: row.sum_goal_value as number,
        median_goal_value: row.median_goal_value as number,
      } as ChartDataPoint & { sum_goal_value: number; median_goal_value: number })
    }

    // Build final data structure
    return summaryCurrentData.map((row) => {
      const goalName = row.goal_name as string
      const prev = summaryPrevMap.get(goalName)

      const currentChartData = tsCurrentByGoal.get(goalName) || []
      const previousChartData = tsPreviousByGoal.get(goalName) || []

      // Helper to calculate change
      const calcChange = (current: number, previous?: number) =>
        previous && previous > 0 ? ((current - previous) / previous) * 100 : undefined

      // Helper to extract metric-specific chart data
      const extractChartData = (
        data: (ChartDataPoint & { sum_goal_value?: number; median_goal_value?: number })[],
        metric: 'goals' | 'sum_goal_value' | 'median_goal_value'
      ): ChartDataPoint[] =>
        data.map((d) => ({
          timestamp: d.timestamp,
          value: metric === 'goals' ? d.value : (d[metric] ?? 0),
        }))

      return {
        goal_name: goalName,
        metrics: {
          goals: {
            current: row.goals as number,
            previous: prev?.goals,
            change: calcChange(row.goals as number, prev?.goals),
            chartData: extractChartData(currentChartData, 'goals'),
            chartDataPrev: extractChartData(previousChartData, 'goals'),
          },
          sum_goal_value: {
            current: row.sum_goal_value as number,
            previous: prev?.sum_goal_value,
            change: calcChange(row.sum_goal_value as number, prev?.sum_goal_value),
            chartData: extractChartData(currentChartData, 'sum_goal_value'),
            chartDataPrev: extractChartData(previousChartData, 'sum_goal_value'),
          },
          median_goal_value: {
            current: row.median_goal_value as number,
            previous: prev?.median_goal_value,
            change: calcChange(row.median_goal_value as number, prev?.median_goal_value),
            chartData: extractChartData(currentChartData, 'median_goal_value'),
            chartDataPrev: extractChartData(previousChartData, 'median_goal_value'),
          },
        },
      }
    })
  }, [goalsResponse, timeSeriesResponse, showComparison, granularity])

  // Handle view click - open dashboard drawer
  const handleView = (goalName: string) => {
    setSelectedGoal(goalName)
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

      {isLoading && goalsData.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} active paragraph={{ rows: 4 }} />
          ))}
        </div>
      ) : goalsData.length === 0 ? (
        <Empty
          description="No goals tracked yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-12"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {goalsData.map((goal) => (
            <GoalCard
              key={goal.goal_name}
              goalName={goal.goal_name}
              metrics={goal.metrics}
              showComparison={showComparison}
              currency={workspace.currency}
              annotations={filteredAnnotations}
              granularity={granularity}
              timezone={workspace.timezone}
              onViewDashboard={() => handleView(goal.goal_name)}
            />
          ))}
        </div>
      )}

      {/* Goal Dashboard Drawer */}
      {selectedGoal && (
        <GoalDashboardDrawer
          open={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false)
            setSelectedGoal(null)
          }}
          workspaceId={workspaceId}
          goalName={selectedGoal}
          dateRange={dateRange}
          showComparison={showComparison}
          timezone={workspace.timezone}
          currency={workspace.currency}
          annotations={filteredAnnotations}
        />
      )}
    </div>
  )
}
