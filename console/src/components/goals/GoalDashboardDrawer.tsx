import { useState, useMemo } from 'react'
import { Drawer, Statistic, Skeleton, Tag } from 'antd'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { analyticsQueryOptions } from '../../lib/queries'
import { formatNumber, formatCurrency, determineGranularity } from '../../lib/chart-utils'
import { determineGranularityForRange, computeDateRange } from '../../lib/date-utils'
import { DashboardProvider } from '../../hooks/useDashboardContext'
import { MetricChart } from '../dashboard/MetricChart'
import { DimensionTableWidget } from '../dashboard/DimensionTableWidget'
import { TrafficHeatmapWidget, type HeatmapDataPoint, type HeatmapTab } from '../dashboard/TrafficHeatmapWidget'
import type { DateRange, DatePreset, Granularity } from '../../types/analytics'
import type { MetricConfig, DimensionTabConfig, ColumnConfig, ChartDataPoint } from '../../types/dashboard'
import type { Annotation } from '../../types/workspace'

// Goal-specific metric configuration
type GoalMetricKey = 'goals' | 'sum_goal_value' | 'median_goal_value'

interface GoalMetricConfig {
  key: GoalMetricKey
  label: string
  format: 'number' | 'currency'
  color: string
  previousColor: string
}

const GOAL_METRICS: GoalMetricConfig[] = [
  { key: 'goals', label: 'Count', format: 'number', color: '#10b981', previousColor: '#9ca3af' },
  { key: 'sum_goal_value', label: 'Total Value', format: 'currency', color: '#7763f1', previousColor: '#9ca3af' },
  { key: 'median_goal_value', label: 'Median Value', format: 'currency', color: '#3b82f6', previousColor: '#9ca3af' },
]

// Widget columns configuration for goals
const GOAL_COLUMNS: ColumnConfig[] = [
  { key: 'goals', label: 'Count', format: 'number' },
  { key: 'sum_goal_value', label: 'Value', format: 'currency' },
]

// Heatmap tabs for goals - only show goals count, no TimeScore
const GOAL_HEATMAP_TABS: HeatmapTab[] = [
  { key: 'sessions', label: 'Goals' }, // Uses 'sessions' key since HeatmapDataPoint.sessions holds goals count
]

interface GoalDashboardDrawerProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  goalName: string
  dateRange: DateRange
  showComparison: boolean
  timezone: string
  currency: string
  annotations?: Annotation[]
}

interface GoalMetricData {
  current: ChartDataPoint[]
  previous: ChartDataPoint[]
  currentTotal: number
  previousTotal: number
  changePercent: number
}

export function GoalDashboardDrawer({
  open,
  onClose,
  workspaceId,
  goalName,
  dateRange,
  showComparison,
  timezone,
  currency,
  annotations = [],
}: GoalDashboardDrawerProps) {
  const [selectedMetric, setSelectedMetric] = useState<GoalMetricKey>('goals')

  // Determine granularity based on date range
  const granularity = useMemo<Granularity>(() => {
    if ('preset' in dateRange && dateRange.preset) {
      return determineGranularity(dateRange.preset as DatePreset)
    }
    if ('start' in dateRange && 'end' in dateRange && dateRange.start && dateRange.end) {
      const computed = computeDateRange('custom', timezone, { start: dateRange.start, end: dateRange.end })
      return determineGranularityForRange(computed.start, computed.end)
    }
    return 'day'
  }, [dateRange, timezone])

  // Build the metrics query
  const metricsQuery = useMemo(() => ({
    workspace_id: workspaceId,
    table: 'goals' as const,
    metrics: GOAL_METRICS.map(m => m.key),
    filters: [{ dimension: 'goal_name', operator: 'equals' as const, values: [goalName] }],
    dateRange: { ...dateRange, granularity },
    ...(showComparison && { compareDateRange: { ...dateRange, granularity } }),
    timezone,
  }), [workspaceId, goalName, dateRange, granularity, showComparison, timezone])

  const { data: response, isFetching } = useQuery({
    ...analyticsQueryOptions(metricsQuery),
    placeholderData: keepPreviousData,
    enabled: open,
  })

  // Heatmap query - day_of_week x hour aggregation (no comparison)
  const heatmapQuery = useMemo(() => ({
    workspace_id: workspaceId,
    table: 'goals' as const,
    metrics: ['goals'],
    dimensions: ['day_of_week', 'hour'],
    filters: [{ dimension: 'goal_name', operator: 'equals' as const, values: [goalName] }],
    dateRange,
    timezone,
  }), [workspaceId, goalName, dateRange, timezone])

  const { data: heatmapResponse, isFetching: heatmapFetching } = useQuery({
    ...analyticsQueryOptions(heatmapQuery),
    placeholderData: keepPreviousData,
    enabled: open,
  })

  // Transform heatmap response
  const heatmapData: HeatmapDataPoint[] = useMemo(() => {
    if (!heatmapResponse?.data) return []

    const rows = Array.isArray(heatmapResponse.data) ? heatmapResponse.data : []

    return rows.map((row: Record<string, unknown>) => ({
      day_of_week: row.day_of_week as number,
      hour: row.hour as number,
      sessions: row.goals as number, // Use goals count as intensity
      median_duration: 0, // Not used for goals heatmap
    }))
  }, [heatmapResponse])

  // Extract and transform goal data
  const goalData = useMemo(() => {
    if (!response?.data) return null

    const data = response.data as { current: Record<string, unknown>[]; previous: Record<string, unknown>[] }
    const dateColumn = getDateColumn(granularity)

    const metrics: Record<GoalMetricKey, GoalMetricData> = {} as Record<GoalMetricKey, GoalMetricData>

    for (const metric of GOAL_METRICS) {
      const currentData = (data.current || []).map((row) => ({
        timestamp: String(row[dateColumn] || ''),
        value: Number(row[metric.key] ?? 0),
      }))

      const previousData = (data.previous || []).map((row) => ({
        timestamp: String(row[dateColumn] || ''),
        value: Number(row[metric.key] ?? 0),
      }))

      const currentTotal = currentData.reduce((sum, d) => sum + d.value, 0)
      const previousTotal = previousData.reduce((sum, d) => sum + d.value, 0)

      // For median, calculate average of time-series values
      const isMedian = metric.key === 'median_goal_value'
      const finalCurrentTotal = isMedian && currentData.length > 0
        ? currentTotal / currentData.length
        : currentTotal
      const finalPreviousTotal = isMedian && previousData.length > 0
        ? previousTotal / previousData.length
        : previousTotal

      const changePercent = finalPreviousTotal !== 0
        ? ((finalCurrentTotal - finalPreviousTotal) / finalPreviousTotal) * 100
        : 0

      metrics[metric.key] = {
        current: currentData,
        previous: previousData,
        currentTotal: finalCurrentTotal,
        previousTotal: finalPreviousTotal,
        changePercent,
      }
    }

    return {
      metrics,
      dateRange: response.meta.dateRange,
      compareDateRange: response.meta.compareDateRange || { start: '', end: '' },
    }
  }, [response, granularity])

  // Tab configurations for dimension widgets
  const sourcesTabConfig: DimensionTabConfig[] = [
    { key: 'referrers', label: 'Referrers', dimensionLabel: 'Referrer', dimension: 'referrer_domain', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
    { key: 'channels', label: 'Channels', dimensionLabel: 'Channel', dimension: 'channel', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
    { key: 'channel_groups', label: 'Channel Groups', dimensionLabel: 'Group', dimension: 'channel_group', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
  ]

  const campaignsTabConfig: DimensionTabConfig[] = [
    { key: 'campaign', label: 'Campaigns', dimensionLabel: 'Campaign', dimension: 'utm_campaign', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' }, filters: [{ dimension: 'utm_campaign', operator: 'isNotEmpty' }] },
    { key: 'source', label: 'Sources', dimensionLabel: 'Source', dimension: 'utm_source', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' }, filters: [{ dimension: 'utm_source', operator: 'isNotEmpty' }] },
    { key: 'medium', label: 'Mediums', dimensionLabel: 'Medium', dimension: 'utm_medium', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' }, filters: [{ dimension: 'utm_medium', operator: 'isNotEmpty' }] },
  ]

  const countriesTabConfig: DimensionTabConfig[] = [
    { key: 'map', label: 'Map', dimensionLabel: 'Country', dimension: 'country', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' }, type: 'country_map', limit: 100 },
    { key: 'list', label: 'List', dimensionLabel: 'Country', dimension: 'country', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
  ]

  const devicesTabConfig: DimensionTabConfig[] = [
    { key: 'device', label: 'Devices', dimensionLabel: 'Device', dimension: 'device', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
    { key: 'browser', label: 'Browsers', dimensionLabel: 'Browser', dimension: 'browser', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
    { key: 'os', label: 'OS', dimensionLabel: 'OS', dimension: 'os', table: 'goals', metrics: ['goals', 'sum_goal_value'], order: { goals: 'desc' } },
  ]

  // Convert GoalMetricConfig to MetricConfig for the chart
  const selectedMetricConfig = GOAL_METRICS.find(m => m.key === selectedMetric)
  const chartMetricConfig: MetricConfig = selectedMetricConfig
    ? {
        key: selectedMetricConfig.key as 'sessions', // Type hack - key is just used for lookup
        label: selectedMetricConfig.label,
        format: selectedMetricConfig.format === 'currency' ? 'number' : selectedMetricConfig.format,
        color: selectedMetricConfig.color,
        previousColor: selectedMetricConfig.previousColor,
      }
    : GOAL_METRICS[0] as unknown as MetricConfig

  const metricData = goalData?.metrics[selectedMetric]

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <Tag color="green" className="m-0">{goalName}</Tag>
          <span className="text-gray-400">-</span>
          <span className="text-gray-500 font-normal">Goal Dashboard</span>
        </div>
      }
      placement="right"
      width="100%"
      open={open}
      onClose={onClose}
      styles={{ body: { background: 'var(--background)' } }}
    >
      <div className={isFetching ? 'opacity-75 transition-opacity' : ''}>
        {/* KPI Summary */}
        <div className="rounded-md overflow-hidden bg-white mb-4">
          <div className="grid grid-cols-3">
            {GOAL_METRICS.map((metric, index) => {
              const data = goalData?.metrics[metric.key]
              const currentTotal = data?.currentTotal ?? 0
              const changePercent = data?.changePercent ?? 0
              const isSelected = selectedMetric === metric.key
              const isLast = index === GOAL_METRICS.length - 1
              const isPositive = changePercent >= 0

              return (
                <div
                  key={metric.key}
                  onClick={() => setSelectedMetric(metric.key)}
                  className={`
                    cursor-pointer p-4 transition-colors
                    ${!isLast ? 'border-r border-gray-200' : ''}
                    ${isSelected ? 'border-b-2 border-b-[var(--primary)]' : 'border-b border-b-gray-200 hover:bg-gray-50'}
                  `}
                >
                  {!response && isFetching ? (
                    <Skeleton active paragraph={false} title={{ width: '60%' }} />
                  ) : (
                    <>
                      <div className="text-xs text-gray-500 mb-1">{metric.label}</div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-semibold text-gray-800">
                          {metric.format === 'currency'
                            ? (currentTotal === 0 ? '-' : formatCurrency(currentTotal, currency))
                            : formatNumber(currentTotal)}
                        </span>
                        {showComparison && changePercent !== 0 && (
                          <Statistic
                            value={Math.abs(changePercent)}
                            precision={1}
                            valueStyle={{
                              fontSize: '12px',
                              color: isPositive ? '#10b981' : '#f97316',
                              fontWeight: 500,
                            }}
                            prefix={changePercent >= 0 ? <ChevronUp size={12} style={{ marginRight: '2px' }} /> : <ChevronDown size={12} style={{ marginRight: '2px' }} />}
                            suffix="%"
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Time-series Chart */}
          <div className="pl-2 pr-4 pt-4 pb-3">
            <MetricChart
              metric={chartMetricConfig}
              currentData={metricData?.current ?? []}
              previousData={showComparison ? (metricData?.previous ?? []) : []}
              granularity={granularity}
              dateRange={goalData?.dateRange ?? { start: '', end: '' }}
              compareDateRange={goalData?.compareDateRange ?? { start: '', end: '' }}
              loading={!response && isFetching}
              height={200}
              annotations={annotations}
              timezone={timezone}
            />
          </div>
        </div>

        {/* Dimension Widgets - wrapped in DashboardProvider with goal filter */}
        <DashboardProvider
          workspaceId={workspaceId}
          dateRange={dateRange}
          compareDateRange={showComparison ? dateRange : undefined}
          timezone={timezone}
          globalFilters={[{ dimension: 'goal_name', operator: 'equals', values: [goalName] }]}
          showComparison={showComparison}
          timescoreReference={0}
          showEvoDetails={false}
          setShowEvoDetails={() => {}}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DimensionTableWidget
              title="Top Sources"
              tabs={sourcesTabConfig}
              columns={GOAL_COLUMNS.map(c => c.key === 'sum_goal_value' ? { ...c, currency } : c)}
              iconPrefix={(value, tabKey) =>
                tabKey === 'referrers' && value ? (
                  <img
                    src={`/api/tools.favicon?url=https://${encodeURIComponent(value)}`}
                    alt=""
                    className="w-4 h-4 shrink-0"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                ) : null
              }
            />
            <DimensionTableWidget
              title="Top Campaigns"
              tabs={campaignsTabConfig}
              columns={GOAL_COLUMNS.map(c => c.key === 'sum_goal_value' ? { ...c, currency } : c)}
              emptyText="No campaign data"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <DimensionTableWidget
              title="Countries"
              tabs={countriesTabConfig}
              columns={GOAL_COLUMNS.map(c => c.key === 'sum_goal_value' ? { ...c, currency } : c)}
              iconPrefix={(value, tabKey) =>
                tabKey === 'list' && value ? <span className={`fi fi-${value.toLowerCase()} shrink-0 relative`} /> : null
              }
            />
            <DimensionTableWidget
              title="Devices"
              tabs={devicesTabConfig}
              columns={GOAL_COLUMNS.map(c => c.key === 'sum_goal_value' ? { ...c, currency } : c)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <TrafficHeatmapWidget
              title="Goals by Day and Hour"
              data={heatmapData}
              loading={heatmapFetching && !heatmapResponse}
              timescoreReference={0}
              emptyText="No goal data"
              tabs={GOAL_HEATMAP_TABS}
            />
          </div>
        </DashboardProvider>
      </div>
    </Drawer>
  )
}

function getDateColumn(granularity: Granularity): string {
  const columns: Record<Granularity, string> = {
    hour: 'date_hour',
    day: 'date_day',
    week: 'date_week',
    month: 'date_month',
    year: 'date_year',
  }
  return columns[granularity]
}
