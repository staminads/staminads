import { useState, useMemo, useCallback } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Alert } from 'antd'
import { getDeviceIcon } from '../../lib/device-icons'
import { analyticsQueryOptions } from '../../lib/queries'
import { determineGranularity, getAvailableGranularities } from '../../lib/chart-utils'
import { determineGranularityForRange, computeDateRange } from '../../lib/date-utils'
import { useDashboardParams } from '../../hooks/useDashboardParams'
import { DashboardProvider } from '../../hooks/useDashboardContext'
import { MetricSummary } from './MetricSummary'
import { MetricChart } from './MetricChart'
import { GranularitySelector } from './GranularitySelector'
import { DimensionTableWidget } from './DimensionTableWidget'
import { TrafficHeatmapWidget, type HeatmapDataPoint } from './TrafficHeatmapWidget'
import {
  METRICS,
  extractDashboardData,
  type MetricKey,
  type ComparisonMode,
  type DimensionTabConfig
} from '../../types/dashboard'
import type { DatePreset, Granularity, Filter } from '../../types/analytics'
import type { Annotation } from '../../types/workspace'

interface DashboardGridProps {
  workspaceId: string
  workspaceTimezone: string
  timescoreReference: number
  comparison: ComparisonMode
  customStart?: string
  customEnd?: string
  annotations?: Annotation[]
  globalFilters?: Filter[]
  onAddFilter?: (filter: Filter | Filter[]) => void
}

export function DashboardGrid({
  workspaceId,
  workspaceTimezone,
  timescoreReference,
  comparison,
  customStart,
  customEnd,
  annotations,
  globalFilters = [],
  onAddFilter
}: DashboardGridProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('sessions')
  const { period, timezone } = useDashboardParams(workspaceTimezone)

  // Key for resetting granularity override when period changes
  const periodKey = `${period}-${customStart}-${customEnd}`
  const [granularityOverride, setGranularityOverride] = useState<{ key: string; value: Granularity | null }>({ key: periodKey, value: null })

  // Reset override if period changed
  const currentOverride = granularityOverride.key === periodKey ? granularityOverride.value : null

  // Compute date range to get the number of days
  const dateRangeForGranularity = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return computeDateRange('custom', timezone, { start: customStart, end: customEnd })
    }
    return computeDateRange(period as DatePreset, timezone)
  }, [period, timezone, customStart, customEnd])

  const dateRangeDays = dateRangeForGranularity.end.diff(dateRangeForGranularity.start, 'day')
  const availableGranularities = getAvailableGranularities(dateRangeDays)

  // Determine default granularity
  const defaultGranularity = period === 'custom' && customStart && customEnd
    ? determineGranularityForRange(dateRangeForGranularity.start, dateRangeForGranularity.end)
    : determineGranularity(period as DatePreset)

  // Use override if valid, otherwise default
  const granularity = currentOverride && availableGranularities.includes(currentOverride)
    ? currentOverride
    : defaultGranularity

  // Handler to update granularity override
  const handleGranularityChange = useCallback((value: Granularity | null) => {
    setGranularityOverride({ key: periodKey, value })
  }, [periodKey])

  const showComparison = comparison !== 'none'

  // Build date range objects for context (no granularity - only for time-series)
  const dateRange = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd }
    }
    return { preset: period as DatePreset }
  }, [period, customStart, customEnd])

  const compareDateRange = useMemo(() => {
    if (!showComparison) return undefined
    if (period === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd }
    }
    return { preset: period as DatePreset }
  }, [showComparison, period, customStart, customEnd])

  // Main metrics query (for time-series chart)
  const metricsQuery = {
    workspace_id: workspaceId,
    metrics: METRICS.map((m) => m.key),
    filters: globalFilters.length > 0 ? globalFilters : undefined,
    dateRange: {
      preset: period as DatePreset,
      granularity,
      ...(period === 'custom' &&
        customStart &&
        customEnd && {
          start: customStart,
          end: customEnd,
          preset: undefined
        })
    },
    ...(showComparison && {
      compareDateRange: {
        preset: period as DatePreset,
        granularity,
        ...(period === 'custom' &&
          customStart &&
          customEnd && {
            start: customStart,
            end: customEnd,
            preset: undefined
          })
      }
    }),
    timezone
  }

  const {
    data: response,
    isFetching,
    isError,
    error
  } = useQuery({
    ...analyticsQueryOptions(metricsQuery),
    placeholderData: keepPreviousData
  })

  const dashboardData = response ? extractDashboardData(response, granularity) : null

  // Heatmap query - day_of_week x hour aggregation (no comparison)
  const heatmapQuery = {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['day_of_week', 'hour'],
    filters: globalFilters.length > 0 ? globalFilters : undefined,
    dateRange: {
      preset: period as DatePreset,
      ...(period === 'custom' &&
        customStart &&
        customEnd && {
          start: customStart,
          end: customEnd,
          preset: undefined
        })
    },
    timezone
  }

  const { data: heatmapResponse, isFetching: heatmapFetching } = useQuery({
    ...analyticsQueryOptions(heatmapQuery),
    placeholderData: keepPreviousData
  })

  // Transform heatmap response
  const heatmapData: HeatmapDataPoint[] = useMemo(() => {
    if (!heatmapResponse?.data) return []

    const rows = Array.isArray(heatmapResponse.data) ? heatmapResponse.data : []

    return rows.map((row: Record<string, unknown>) => ({
      day_of_week: row.day_of_week as number,
      hour: row.hour as number,
      sessions: row.sessions as number,
      median_duration: row.median_duration as number
    }))
  }, [heatmapResponse])

  // Widget tab configurations
  const pagesTabConfig: DimensionTabConfig[] = [
    {
      key: 'landing',
      label: 'Landing pages',
      dimensionLabel: 'Page',
      dimension: 'landing_path',
      metrics: ['sessions', 'median_duration', 'bounce_rate']
    },
    {
      key: 'exits',
      label: 'Exits',
      dimensionLabel: 'Exit page',
      dimension: 'exit_path',
      metrics: ['sessions', 'median_duration']
    }
  ]

  const sourcesTabConfig: DimensionTabConfig[] = [
    {
      key: 'referrers',
      label: 'Referrers',
      dimensionLabel: 'Referrer domain',
      dimension: 'referrer_domain'
    },
    {
      key: 'channels',
      label: 'Channels',
      dimensionLabel: 'Channel',
      dimension: 'channel'
    },
    {
      key: 'channel_groups',
      label: 'Channel groups',
      dimensionLabel: 'Channel group',
      dimension: 'channel_group'
    }
  ]

  const campaignsTabConfig: DimensionTabConfig[] = [
    {
      key: 'campaign',
      label: 'Campaigns',
      dimensionLabel: 'utm_campaign',
      dimension: 'utm_campaign',
      filters: [{ dimension: 'utm_campaign', operator: 'isNotEmpty' }]
    },
    {
      key: 'source',
      label: 'Sources',
      dimensionLabel: 'utm_source',
      dimension: 'utm_source',
      filters: [{ dimension: 'utm_source', operator: 'isNotEmpty' }]
    },
    {
      key: 'medium',
      label: 'Mediums',
      dimensionLabel: 'utm_medium',
      dimension: 'utm_medium',
      filters: [{ dimension: 'utm_medium', operator: 'isNotEmpty' }]
    },
    {
      key: 'content',
      label: 'Contents',
      dimensionLabel: 'utm_content',
      dimension: 'utm_content',
      filters: [{ dimension: 'utm_content', operator: 'isNotEmpty' }]
    },
    {
      key: 'term',
      label: 'Terms',
      dimensionLabel: 'utm_term',
      dimension: 'utm_term',
      filters: [{ dimension: 'utm_term', operator: 'isNotEmpty' }]
    }
  ]

  const countriesTabConfig: DimensionTabConfig[] = [
    {
      key: 'map',
      label: 'Map',
      dimensionLabel: 'Country',
      dimension: 'country',
      type: 'country_map',
      limit: 100
    },
    {
      key: 'list',
      label: 'List',
      dimensionLabel: 'Country',
      dimension: 'country'
    }
  ]

  const devicesTabConfig: DimensionTabConfig[] = [
    { key: 'devices', label: 'Devices', dimensionLabel: 'Device', dimension: 'device' },
    { key: 'browsers', label: 'Browsers', dimensionLabel: 'Browser', dimension: 'browser' },
    { key: 'os', label: 'OS', dimensionLabel: 'OS', dimension: 'os' }
  ]

  // Mapping from tab key to dimension for click-to-filter
  const tabKeyToDimension: Record<string, string> = useMemo(() => ({
    // Pages
    landing: 'landing_path',
    exit: 'exit_path',
    // Sources
    referrers: 'referrer_domain',
    channels: 'channel',
    channel_groups: 'channel_group',
    // Campaigns
    campaign: 'utm_campaign',
    source: 'utm_source',
    medium: 'utm_medium',
    content: 'utm_content',
    term: 'utm_term',
    // Countries
    map: 'country',
    list: 'country',
    // Devices
    devices: 'device',
    browsers: 'browser',
    os: 'os',
  }), [])

  // Generic row click handler that adds a filter
  const handleRowClick = useCallback((row: { dimension_value: string }, tabKey: string) => {
    if (!onAddFilter) return
    const dimension = tabKeyToDimension[tabKey]
    if (!dimension) return

    onAddFilter({
      dimension,
      operator: 'equals',
      values: [row.dimension_value]
    })
  }, [onAddFilter, tabKeyToDimension])

  // Heatmap cell click handler - adds filters for day_of_week and hour atomically
  const handleHeatmapCellClick = useCallback((dayOfWeek: number, hour: number) => {
    if (!onAddFilter) return
    // Add both filters in a single call for atomic URL update
    onAddFilter([
      { dimension: 'day_of_week', operator: 'equals', values: [dayOfWeek] },
      { dimension: 'hour', operator: 'equals', values: [hour] }
    ])
  }, [onAddFilter])

  if (isError) {
    return (
      <Alert
        message="Error loading dashboard data"
        description={error instanceof Error ? error.message : 'An unexpected error occurred'}
        type="error"
        showIcon
      />
    )
  }

  const metric = METRICS.find((m) => m.key === selectedMetric)!
  const metricData = dashboardData?.metrics[selectedMetric]

  return (
    <DashboardProvider
      workspaceId={workspaceId}
      dateRange={dateRange}
      compareDateRange={compareDateRange}
      timezone={timezone}
      globalFilters={globalFilters}
      showComparison={showComparison}
      timescoreReference={timescoreReference}
    >
      <div className={isFetching ? 'opacity-75 transition-opacity' : ''}>
        <div className="rounded-md overflow-hidden bg-white">
          <MetricSummary
            data={dashboardData}
            loading={!response && isFetching}
            selectedMetric={selectedMetric}
            onMetricSelect={setSelectedMetric}
            showComparison={showComparison}
          />
          <div className="pl-2 pr-4 pt-4 pb-3 relative">
            {availableGranularities.length > 1 && (
              <div className="absolute top-4 right-4 z-10">
                <GranularitySelector
                  value={granularity}
                  onChange={handleGranularityChange}
                  availableGranularities={availableGranularities}
                />
              </div>
            )}
            <MetricChart
              metric={metric}
              currentData={metricData?.current ?? []}
              previousData={showComparison ? (metricData?.previous ?? []) : []}
              granularity={granularity}
              dateRange={dashboardData?.dateRange ?? { start: '', end: '' }}
              compareDateRange={dashboardData?.compareDateRange ?? { start: '', end: '' }}
              loading={!response && isFetching}
              height={200}
              annotations={annotations}
              timezone={workspaceTimezone}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <DimensionTableWidget
            title="Top Pages"
            tabs={pagesTabConfig}
            onRowClick={handleRowClick}
          />
          <DimensionTableWidget
            title="Top Sources"
            tabs={sourcesTabConfig}
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
            onRowClick={handleRowClick}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <DimensionTableWidget
            title="Top Campaigns"
            tabs={campaignsTabConfig}
            emptyText="No campaign data"
            onRowClick={handleRowClick}
          />
          <DimensionTableWidget
            title="Countries"
            tabs={countriesTabConfig}
            iconPrefix={(value, tabKey) =>
              tabKey === 'list' && value ? <span className={`fi fi-${value.toLowerCase()} shrink-0 relative`} /> : null
            }
            emptyText="No country data"
            onRowClick={handleRowClick}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <TrafficHeatmapWidget
            title="Traffic by Day and Hour"
            data={heatmapData}
            loading={heatmapFetching && !heatmapResponse}
            timescoreReference={timescoreReference}
            emptyText="No traffic data"
            onCellClick={handleHeatmapCellClick}
          />
          <DimensionTableWidget
            title="Devices"
            tabs={devicesTabConfig}
            iconPrefix={getDeviceIcon}
            onRowClick={handleRowClick}
          />
        </div>
      </div>
    </DashboardProvider>
  )
}
