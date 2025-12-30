import { useState, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Alert, Card } from 'antd'
import { analyticsQueryOptions } from '../../lib/queries'
import { determineGranularity } from '../../lib/chart-utils'
import { determineGranularityForRange, computeDateRange } from '../../lib/date-utils'
import { useDashboardParams } from '../../hooks/useDashboardParams'
import { MetricSummary } from './MetricSummary'
import { MetricChart } from './MetricChart'
import { TopPagesWidget, type PageData } from './TopPagesWidget'
import { METRICS, extractDashboardData, type MetricKey, type ComparisonMode } from '../../types/dashboard'
import type { DatePreset, Granularity } from '../../types/analytics'

interface DashboardGridProps {
  workspaceId: string
  workspaceTimezone: string
  workspaceCreatedAt?: string
  comparison: ComparisonMode
  customStart?: string
  customEnd?: string
}

export function DashboardGrid({
  workspaceId,
  workspaceTimezone,
  workspaceCreatedAt: _workspaceCreatedAt,
  comparison,
  customStart,
  customEnd,
}: DashboardGridProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('sessions')
  const { period, timezone } = useDashboardParams(workspaceTimezone)

  // Determine granularity - for custom ranges, compute dynamically
  let granularity: Granularity
  if (period === 'custom' && customStart && customEnd) {
    const range = computeDateRange('custom', timezone, { start: customStart, end: customEnd })
    granularity = determineGranularityForRange(range.start, range.end)
  } else {
    granularity = determineGranularity(period as DatePreset)
  }

  const showComparison = comparison !== 'none'

  const query = {
    workspace_id: workspaceId,
    metrics: METRICS.map((m) => m.key),
    dateRange: {
      preset: period as DatePreset,
      granularity,
      ...(period === 'custom' && customStart && customEnd && {
        start: customStart,
        end: customEnd,
        preset: undefined,
      }),
    },
    // Only include comparison if enabled
    ...(showComparison && {
      compareDateRange: {
        preset: period as DatePreset,
        granularity,
        ...(period === 'custom' && customStart && customEnd && {
          start: customStart,
          end: customEnd,
          preset: undefined,
        }),
      },
    }),
    timezone,
  }

  const { data: response, isFetching, isError, error } = useQuery({
    ...analyticsQueryOptions(query),
    placeholderData: keepPreviousData,
  })

  const dashboardData = response ? extractDashboardData(response, granularity) : null

  // Pages query - no granularity, grouped by landing_path
  const pagesQuery = {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration', 'bounce_rate'],
    dimensions: ['landing_path'],
    dateRange: {
      preset: period as DatePreset,
      ...(period === 'custom' && customStart && customEnd && {
        start: customStart,
        end: customEnd,
        preset: undefined,
      }),
    },
    ...(showComparison && {
      compareDateRange: {
        preset: period as DatePreset,
        ...(period === 'custom' && customStart && customEnd && {
          start: customStart,
          end: customEnd,
          preset: undefined,
        }),
      },
    }),
    order: { sessions: 'desc' as const },
    limit: 10,
    timezone,
  }

  const { data: pagesResponse, isFetching: pagesFetching } = useQuery({
    ...analyticsQueryOptions(pagesQuery),
    placeholderData: keepPreviousData,
  })

  // Transform API response to widget format
  const pagesData: PageData[] = useMemo(() => {
    if (!pagesResponse?.data) return []

    // When compareDateRange is used, data is { current: [], previous: [] }
    // Otherwise, data is just []
    const hasComparison = typeof pagesResponse.data === 'object' && 'current' in pagesResponse.data

    if (hasComparison) {
      const { current, previous } = pagesResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      return current.map((row) => {
        const prevRow = previous?.find((p) => p.landing_path === row.landing_path)
        return {
          landing_path: row.landing_path as string,
          sessions: row.sessions as number,
          median_duration: row.median_duration as number,
          bounce_rate: row.bounce_rate as number,
          prev_sessions: prevRow?.sessions as number | undefined,
          prev_median_duration: prevRow?.median_duration as number | undefined,
        }
      })
    }

    // No comparison - flat array
    return (pagesResponse.data as Record<string, unknown>[]).map((row) => ({
      landing_path: row.landing_path as string,
      sessions: row.sessions as number,
      median_duration: row.median_duration as number,
      bounce_rate: row.bounce_rate as number,
    }))
  }, [pagesResponse])

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
    <div className={isFetching ? 'opacity-75 transition-opacity' : ''}>
      <Card className="shadow-sm" styles={{ body: { padding: 0 } }}>
        <MetricSummary
          data={dashboardData}
          loading={!response && isFetching}
          selectedMetric={selectedMetric}
          onMetricSelect={setSelectedMetric}
          showComparison={showComparison}
        />
        <div className="pl-2 pr-4 pt-4 pb-3">
          <MetricChart
            metric={metric}
            currentData={metricData?.current ?? []}
            previousData={showComparison ? (metricData?.previous ?? []) : []}
            granularity={granularity}
            dateRange={dashboardData?.dateRange ?? { start: '', end: '' }}
            compareDateRange={dashboardData?.compareDateRange ?? { start: '', end: '' }}
            loading={!response && isFetching}
            height={240}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <TopPagesWidget
          title="Top Visited Pages"
          data={pagesData}
          loading={pagesFetching && !pagesResponse}
          sortBy="sessions"
          showComparison={showComparison}
          workspaceId={workspaceId}
        />
        <TopPagesWidget
          title="Most Engaging Pages"
          data={pagesData}
          loading={pagesFetching && !pagesResponse}
          sortBy="median_duration"
          showComparison={showComparison}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  )
}
