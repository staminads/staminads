import { useState, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Alert } from 'antd'
import { analyticsQueryOptions } from '../../lib/queries'
import { determineGranularity } from '../../lib/chart-utils'
import { determineGranularityForRange, computeDateRange } from '../../lib/date-utils'
import { useDashboardParams } from '../../hooks/useDashboardParams'
import { MetricSummary } from './MetricSummary'
import { MetricChart } from './MetricChart'
import { TabbedPagesWidget, type PageData } from './TabbedPagesWidget'
import { TabbedSourcesWidget, type SourceData } from './TabbedSourcesWidget'
import { TabbedChannelsWidget, type ChannelData } from './TabbedChannelsWidget'
import { TabbedCampaignsWidget, type CampaignData } from './TabbedCampaignsWidget'
import { TabbedCountriesWidget, type CountryData } from './TabbedCountriesWidget'
import { CountriesMapWidget } from './CountriesMapWidget'
import { METRICS, extractDashboardData, type MetricKey, type ComparisonMode } from '../../types/dashboard'
import type { DatePreset, Granularity } from '../../types/analytics'
import type { Annotation } from '../../types/workspace'

interface DashboardGridProps {
  workspaceId: string
  workspaceTimezone: string
  workspaceCreatedAt?: string
  timescoreReference: number
  comparison: ComparisonMode
  customStart?: string
  customEnd?: string
  annotations?: Annotation[]
}

export function DashboardGrid({
  workspaceId,
  workspaceTimezone,
  workspaceCreatedAt: _workspaceCreatedAt,
  timescoreReference,
  comparison,
  customStart,
  customEnd,
  annotations,
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

  // Sources query - referrer_domain with channel=not-mapped filter (new/unmapped sources)
  const sourcesQuery = {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['referrer_domain'],
    filters: [{ dimension: 'channel', operator: 'equals' as const, values: ['not-mapped'] }],
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

  const { data: sourcesResponse, isFetching: sourcesFetching } = useQuery({
    ...analyticsQueryOptions(sourcesQuery),
    placeholderData: keepPreviousData,
  })

  // Channels query - channel dimension (all traffic)
  const channelsQuery = {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['channel'],
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

  const { data: channelsResponse, isFetching: channelsFetching } = useQuery({
    ...analyticsQueryOptions(channelsQuery),
    placeholderData: keepPreviousData,
  })

  // Campaigns query - utm_campaign dimension
  const campaignsQuery = {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['utm_campaign'],
    filters: [{ dimension: 'utm_campaign', operator: 'isNotEmpty' as const }],
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

  const { data: campaignsResponse, isFetching: campaignsFetching } = useQuery({
    ...analyticsQueryOptions(campaignsQuery),
    placeholderData: keepPreviousData,
  })

  // Countries query - country dimension
  const countriesQuery = {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['country'],
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

  const { data: countriesResponse, isFetching: countriesFetching } = useQuery({
    ...analyticsQueryOptions(countriesQuery),
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

  // Transform sources response to widget format
  const sourcesData: SourceData[] = useMemo(() => {
    if (!sourcesResponse?.data) return []

    const hasComparison = typeof sourcesResponse.data === 'object' && 'current' in sourcesResponse.data

    if (hasComparison) {
      const { current, previous } = sourcesResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      return current.map((row) => {
        const prevRow = previous?.find((p) => p.referrer_domain === row.referrer_domain)
        return {
          dimension_value: row.referrer_domain as string,
          sessions: row.sessions as number,
          median_duration: row.median_duration as number,
          prev_sessions: prevRow?.sessions as number | undefined,
          prev_median_duration: prevRow?.median_duration as number | undefined,
        }
      })
    }

    return (sourcesResponse.data as Record<string, unknown>[]).map((row) => ({
      dimension_value: row.referrer_domain as string,
      sessions: row.sessions as number,
      median_duration: row.median_duration as number,
    }))
  }, [sourcesResponse])

  // Transform channels response to widget format
  const channelsData: ChannelData[] = useMemo(() => {
    if (!channelsResponse?.data) return []

    const hasComparison = typeof channelsResponse.data === 'object' && 'current' in channelsResponse.data

    if (hasComparison) {
      const { current, previous } = channelsResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      return current.map((row) => {
        const prevRow = previous?.find((p) => p.channel === row.channel)
        return {
          dimension_value: row.channel as string,
          sessions: row.sessions as number,
          median_duration: row.median_duration as number,
          prev_sessions: prevRow?.sessions as number | undefined,
          prev_median_duration: prevRow?.median_duration as number | undefined,
        }
      })
    }

    return (channelsResponse.data as Record<string, unknown>[]).map((row) => ({
      dimension_value: row.channel as string,
      sessions: row.sessions as number,
      median_duration: row.median_duration as number,
    }))
  }, [channelsResponse])

  // Transform campaigns response to widget format
  const campaignsData: CampaignData[] = useMemo(() => {
    if (!campaignsResponse?.data) return []

    const hasComparison = typeof campaignsResponse.data === 'object' && 'current' in campaignsResponse.data

    if (hasComparison) {
      const { current, previous } = campaignsResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      return current.map((row) => {
        const prevRow = previous?.find((p) => p.utm_campaign === row.utm_campaign)
        return {
          dimension_value: row.utm_campaign as string,
          sessions: row.sessions as number,
          median_duration: row.median_duration as number,
          prev_sessions: prevRow?.sessions as number | undefined,
          prev_median_duration: prevRow?.median_duration as number | undefined,
        }
      })
    }

    return (campaignsResponse.data as Record<string, unknown>[]).map((row) => ({
      dimension_value: row.utm_campaign as string,
      sessions: row.sessions as number,
      median_duration: row.median_duration as number,
    }))
  }, [campaignsResponse])

  // Transform countries response to widget format
  const countriesData: CountryData[] = useMemo(() => {
    if (!countriesResponse?.data) return []

    const hasComparison = typeof countriesResponse.data === 'object' && 'current' in countriesResponse.data

    if (hasComparison) {
      const { current, previous } = countriesResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      return current.map((row) => {
        const prevRow = previous?.find((p) => p.country === row.country)
        return {
          dimension_value: row.country as string,
          sessions: row.sessions as number,
          median_duration: row.median_duration as number,
          prev_sessions: prevRow?.sessions as number | undefined,
          prev_median_duration: prevRow?.median_duration as number | undefined,
        }
      })
    }

    return (countriesResponse.data as Record<string, unknown>[]).map((row) => ({
      dimension_value: row.country as string,
      sessions: row.sessions as number,
      median_duration: row.median_duration as number,
    }))
  }, [countriesResponse])

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
      <div className="rounded-md overflow-hidden bg-white">
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
            height={200}
            annotations={annotations}
            timezone={workspaceTimezone}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <TabbedPagesWidget
          title="Top Pages"
          data={pagesData}
          loading={pagesFetching && !pagesResponse}
          showComparison={showComparison}
          timescoreReference={timescoreReference}
          workspaceId={workspaceId}
        />
        <TabbedSourcesWidget
          title="Sources not mapped"
          infoTooltip="Referrers not assigned to a channel dimension in the Filters"
          data={sourcesData}
          loading={sourcesFetching && !sourcesResponse}
          showComparison={showComparison}
          timescoreReference={timescoreReference}
          showFavicon
          emptyText="No unmapped sources"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <TabbedChannelsWidget
          title="Top Channels"
          data={channelsData}
          loading={channelsFetching && !channelsResponse}
          showComparison={showComparison}
          timescoreReference={timescoreReference}
          emptyText="No channel data"
        />
        <TabbedCampaignsWidget
          title="Top Campaigns"
          data={campaignsData}
          loading={campaignsFetching && !campaignsResponse}
          showComparison={showComparison}
          timescoreReference={timescoreReference}
          emptyText="No campaign data"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <TabbedCountriesWidget
          title="Top Countries"
          data={countriesData}
          loading={countriesFetching && !countriesResponse}
          showComparison={showComparison}
          timescoreReference={timescoreReference}
          emptyText="No country data"
        />
        <CountriesMapWidget
          title="Countries Map"
          data={countriesData}
          loading={countriesFetching && !countriesResponse}
          timescoreReference={timescoreReference}
          emptyText="No country data"
        />
      </div>
    </div>
  )
}
