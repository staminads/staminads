import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { DatePreset, Filter } from '../types/analytics'
import type { ComparisonMode, WorkspaceSearch } from '../types/dashboard'

const DEBOUNCE_MS = 200
const STORAGE_KEY_DIMENSIONS = 'explore_dimensions'
const STORAGE_KEY_MIN_SESSIONS = 'explore_min_sessions'
const STORAGE_KEY_PERIOD = 'explore_period'
const STORAGE_KEY_COMPARISON = 'explore_comparison'

export function useExploreParams(workspaceTimezone: string) {
  const search = useSearch({ strict: false }) as WorkspaceSearch
  const navigate = useNavigate()
  const [pendingDimensions, setPendingDimensions] = useState<string[] | null>(null)

  // Parse dimensions from URL or localStorage
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

  // Load from localStorage on mount if URL params are empty
  useEffect(() => {
    const updates: Partial<WorkspaceSearch> = {}

    if (!search.dimensions) {
      const savedDimensions = localStorage.getItem(STORAGE_KEY_DIMENSIONS)
      if (savedDimensions) {
        updates.dimensions = savedDimensions
      }
    }

    if (!search.minSessions) {
      const savedMinSessions = localStorage.getItem(STORAGE_KEY_MIN_SESSIONS)
      if (savedMinSessions) {
        updates.minSessions = savedMinSessions
      }
    }

    if (!search.period) {
      const savedPeriod = localStorage.getItem(STORAGE_KEY_PERIOD) as DatePreset | null
      if (savedPeriod) {
        updates.period = savedPeriod
      }
    }

    if (!search.comparison) {
      const savedComparison = localStorage.getItem(STORAGE_KEY_COMPARISON) as ComparisonMode | null
      if (savedComparison) {
        updates.comparison = savedComparison
      }
    }

    if (Object.keys(updates).length > 0) {
      navigate({
        search: { ...search, ...updates } as never,
        replace: true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save to localStorage when values change
  useEffect(() => {
    if (search.dimensions) {
      localStorage.setItem(STORAGE_KEY_DIMENSIONS, search.dimensions)
    }
  }, [search.dimensions])

  useEffect(() => {
    if (search.minSessions) {
      localStorage.setItem(STORAGE_KEY_MIN_SESSIONS, search.minSessions)
    }
  }, [search.minSessions])

  useEffect(() => {
    const period = search.period ?? 'last_7_days'
    localStorage.setItem(STORAGE_KEY_PERIOD, period)
  }, [search.period])

  useEffect(() => {
    const comparison = search.comparison ?? 'previous_period'
    localStorage.setItem(STORAGE_KEY_COMPARISON, comparison)
  }, [search.comparison])

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

  return {
    // Parsed values
    dimensions,
    filters,
    minSessions: search.minSessions ? parseInt(search.minSessions, 10) : 1,
    period: (search.period ?? 'last_7_days') as DatePreset,
    timezone: search.timezone ?? workspaceTimezone,
    comparison: (search.comparison ?? 'previous_period') as ComparisonMode,
    customStart: search.customStart,
    customEnd: search.customEnd,

    // Setters
    setDimensions,
    setFilters,
    setMinSessions,
    setPeriod,
    setTimezone,
    setComparison,
    setCustomRange,

    // Pending state
    isPending: pendingDimensions !== null,
  }
}
