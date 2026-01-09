import { useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { analyticsQueryOptions } from '../lib/queries'
import { transformToDimensionData } from '../lib/dimension-utils'
import { useDashboardContext } from './useDashboardContext'
import type { AnalyticsQuery, Filter } from '../types/analytics'
import type { DimensionTabConfig, DimensionData } from '../types/dashboard'

interface UseDimensionQueryResult {
  data: DimensionData[]
  loading: boolean
}

interface UseDimensionQueryOptions {
  limitOverride?: number
  orderOverride?: Record<string, 'asc' | 'desc'>
}

/**
 * Hook to fetch dimension data for a widget tab.
 * Automatically combines global filters from DashboardContext with tab-specific filters.
 *
 * @param tabConfig - The tab configuration defining what data to fetch
 * @param options - Optional overrides for limit and order (for expanded/fullscreen views or sorting)
 * @returns Object with data array and loading state
 */
export function useDimensionQuery(
  tabConfig: DimensionTabConfig,
  options?: UseDimensionQueryOptions
): UseDimensionQueryResult {
  const { limitOverride, orderOverride } = options ?? {}
  const ctx = useDashboardContext()

  // Merge global filters with widget-specific filters
  // Widget filters take precedence for the same dimension
  const mergedFilters = useMemo<Filter[]>(() => {
    const widgetFilters = tabConfig.filters ?? []

    // Filter out global filters that are overridden by widget filters
    const globalFiltersFiltered = ctx.globalFilters.filter(
      (gf) => !widgetFilters.some((wf) => wf.dimension === gf.dimension)
    )

    return [...globalFiltersFiltered, ...widgetFilters]
  }, [ctx.globalFilters, tabConfig.filters])

  // Build the analytics query
  const metrics = useMemo(
    () => tabConfig.metrics ?? ['sessions', 'median_duration'],
    [tabConfig.metrics]
  )
  const query = useMemo<AnalyticsQuery>(
    () => ({
      workspace_id: ctx.workspaceId,
      table: tabConfig.table,
      metrics,
      dimensions: [tabConfig.dimension],
      filters: mergedFilters.length > 0 ? mergedFilters : undefined,
      dateRange: ctx.dateRange,
      ...(ctx.showComparison && ctx.compareDateRange
        ? { compareDateRange: ctx.compareDateRange }
        : {}),
      order: orderOverride ?? tabConfig.order ?? { sessions: 'desc' },
      limit: limitOverride ?? tabConfig.limit ?? 7,
      timezone: ctx.timezone,
    }),
    [ctx, tabConfig, mergedFilters, limitOverride, orderOverride, metrics]
  )

  const { data: response, isFetching } = useQuery({
    ...analyticsQueryOptions(query),
    placeholderData: keepPreviousData,
  })

  // Check if response matches current tab's dimension (avoid stale data from keepPreviousData)
  const responseMatchesTab =
    response?.meta?.dimensions?.[0] === tabConfig.dimension

  // Transform API response to standard DimensionData format
  const data = useMemo<DimensionData[]>(() => {
    if (!responseMatchesTab) return []
    return transformToDimensionData(response, tabConfig.dimensionField ?? tabConfig.dimension, metrics)
  }, [response, responseMatchesTab, tabConfig.dimension, tabConfig.dimensionField, metrics])

  return {
    data,
    loading: isFetching || !responseMatchesTab,
  }
}
