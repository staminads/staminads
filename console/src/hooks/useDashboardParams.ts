import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { DatePreset, Filter } from '../types/analytics'
import type { WorkspaceSearch, ComparisonMode } from '../types/dashboard'

const DEBOUNCE_MS = 200
const STORAGE_KEY_PERIOD = 'dashboard_period'
const STORAGE_KEY_COMPARISON = 'dashboard_comparison'

export function useDashboardParams(workspaceTimezone: string) {
  const search = useSearch({ strict: false }) as WorkspaceSearch
  const navigate = useNavigate()
  const [pendingPeriod, setPendingPeriod] = useState<DatePreset | null>(null)

  // Load from localStorage on mount, but only for URL params that are missing.
  // A single navigate call restores both values at once so they can't clobber
  // each other, and we never overwrite a value already provided by the URL.
  useEffect(() => {
    const savedPeriod = localStorage.getItem(STORAGE_KEY_PERIOD) as DatePreset | null
    const savedComparison = localStorage.getItem(STORAGE_KEY_COMPARISON) as ComparisonMode | null

    const needsPeriod = !search.period && savedPeriod
    const needsComparison = !search.comparison && savedComparison

    if (needsPeriod || needsComparison) {
      navigate({
        search: {
          ...search,
          ...(needsPeriod ? { period: savedPeriod } : {}),
          ...(needsComparison ? { comparison: savedComparison } : {}),
        } as never,
        replace: true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save to localStorage when values change
  useEffect(() => {
    if (search.period) {
      localStorage.setItem(STORAGE_KEY_PERIOD, search.period)
    }
  }, [search.period])

  useEffect(() => {
    if (search.comparison) {
      localStorage.setItem(STORAGE_KEY_COMPARISON, search.comparison)
    }
  }, [search.comparison])

  // Debounce period changes
  useEffect(() => {
    if (pendingPeriod === null) return

    const timer = setTimeout(() => {
      navigate({
        search: { ...search, period: pendingPeriod } as never,
        replace: true,
      })
      setPendingPeriod(null)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [pendingPeriod, navigate, search])

  const setPeriod = useCallback((period: DatePreset) => {
    setPendingPeriod(period)
  }, [])

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

  // Set filters in URL
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

  // Memoize parsed filters
  const filters = useMemo(
    () => parseFilters(search.filters),
    [parseFilters, search.filters],
  )

  return {
    period: (search.period ?? 'previous_7_days') as DatePreset,
    timezone: search.timezone ?? workspaceTimezone,
    comparison: (search.comparison ?? 'previous_period') as ComparisonMode,
    customStart: search.customStart,
    customEnd: search.customEnd,
    filters,
    setPeriod,
    setTimezone,
    setComparison,
    setCustomRange,
    setFilters,
    isPending: pendingPeriod !== null,
  }
}
