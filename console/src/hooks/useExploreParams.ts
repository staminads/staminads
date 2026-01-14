import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { DatePreset, Filter, MetricFilter } from '../types/analytics'
import type { ComparisonMode, WorkspaceSearch } from '../types/dashboard'

const DEBOUNCE_MS = 200

export function useExploreParams(workspaceTimezone: string) {
  const search = useSearch({ strict: false }) as WorkspaceSearch
  const navigate = useNavigate()
  const [pendingDimensions, setPendingDimensions] = useState<string[] | null>(null)

  // Parse dimensions from URL
  const parseDimensions = useCallback((dimensionsStr?: string): string[] => {
    if (dimensionsStr) {
      return dimensionsStr.split(',').filter(Boolean)
    }
    return []
  }, [])

  // Parse filters from URL
  const parseFilters = useCallback((filtersStr?: string): Filter[] => {
    if (filtersStr) {
      try {
        return JSON.parse(filtersStr)
      } catch {
        return []
      }
    }
    return []
  }, [])

  // Parse metric filters from URL
  const parseMetricFilters = useCallback((metricFiltersStr?: string): MetricFilter[] => {
    if (metricFiltersStr) {
      try {
        return JSON.parse(metricFiltersStr)
      } catch {
        return []
      }
    }
    return []
  }, [])

  // Debounce dimension changes
  useEffect(() => {
    if (pendingDimensions === null) return

    const timer = setTimeout(() => {
      navigate({
        search: {
          ...search,
          dimensions: pendingDimensions.join(',') || undefined,
        } as never,
        replace: true,
      })
      setPendingDimensions(null)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [pendingDimensions, navigate, search])

  const setDimensions = useCallback((dimensions: string[]) => {
    setPendingDimensions(dimensions)
  }, [])

  const setFilters = useCallback(
    (filters: Filter[]) => {
      navigate({
        search: {
          ...search,
          filters: filters.length > 0 ? JSON.stringify(filters) : undefined,
        } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  const setMetricFilters = useCallback(
    (metricFilters: MetricFilter[]) => {
      navigate({
        search: {
          ...search,
          metricFilters: metricFilters.length > 0 ? JSON.stringify(metricFilters) : undefined,
        } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  const setMinSessions = useCallback(
    (minSessions: number) => {
      navigate({
        search: {
          ...search,
          minSessions: minSessions > 1 ? String(minSessions) : undefined,
        } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  const setPeriod = useCallback(
    (period: DatePreset) => {
      navigate({
        search: { ...search, period } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  const setTimezone = useCallback(
    (timezone: string) => {
      navigate({
        search: { ...search, timezone } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  const setComparison = useCallback(
    (comparison: ComparisonMode) => {
      navigate({
        search: { ...search, comparison } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  const setCustomRange = useCallback(
    (customStart: string, customEnd: string) => {
      navigate({
        search: { ...search, period: 'custom', customStart, customEnd } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  // Replace all params at once (full override, clears unspecified params)
  const setAll = useCallback(
    (updates: {
      dimensions?: string[]
      filters?: Filter[]
      metricFilters?: MetricFilter[]
      period?: DatePreset
      comparison?: ComparisonMode
      minSessions?: number
      customStart?: string
      customEnd?: string
    }) => {
      // Start fresh - only keep what's explicitly provided
      const newSearch: Record<string, string | undefined> = {}

      // Dimensions: use provided or clear
      newSearch.dimensions = updates.dimensions?.length ? updates.dimensions.join(',') : undefined

      // Filters: use provided or clear
      newSearch.filters = updates.filters?.length ? JSON.stringify(updates.filters) : undefined

      // Metric filters: use provided or clear
      newSearch.metricFilters = updates.metricFilters?.length ? JSON.stringify(updates.metricFilters) : undefined

      // Period: use provided or keep default
      newSearch.period = updates.period || undefined

      // Comparison: use provided or keep default
      newSearch.comparison = updates.comparison || undefined

      // MinSessions: use provided or clear (default is 10 in the hook)
      newSearch.minSessions = updates.minSessions && updates.minSessions > 1 ? String(updates.minSessions) : undefined

      // Custom range: both must be provided
      if (updates.customStart && updates.customEnd) {
        newSearch.period = 'custom'
        newSearch.customStart = updates.customStart
        newSearch.customEnd = updates.customEnd
      }

      navigate({
        search: newSearch as never,
        replace: true,
      })
    },
    [navigate],
  )

  // Memoize parsed values to prevent infinite loops
  // Use pending dimensions for optimistic UI updates during debounce
  const dimensions = useMemo(
    () => pendingDimensions ?? parseDimensions(search.dimensions),
    [parseDimensions, search.dimensions, pendingDimensions],
  )

  const filters = useMemo(
    () => parseFilters(search.filters),
    [parseFilters, search.filters],
  )

  const metricFilters = useMemo(
    () => parseMetricFilters(search.metricFilters),
    [parseMetricFilters, search.metricFilters],
  )

  return {
    // Parsed values
    dimensions,
    filters,
    metricFilters,
    minSessions: search.minSessions ? parseInt(search.minSessions, 10) : 10,
    period: (search.period ?? 'previous_7_days') as DatePreset,
    timezone: search.timezone ?? workspaceTimezone,
    comparison: (search.comparison ?? 'previous_period') as ComparisonMode,
    customStart: search.customStart,
    customEnd: search.customEnd,

    // Setters
    setDimensions,
    setFilters,
    setMetricFilters,
    setMinSessions,
    setPeriod,
    setTimezone,
    setComparison,
    setCustomRange,
    setAll,

    // Pending state
    isPending: pendingDimensions !== null,
  }
}
