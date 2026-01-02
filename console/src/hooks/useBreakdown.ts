import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { calculateChildrenDimensionsAndFilters } from '../lib/explore-utils'
import { api } from '../lib/api'
import type { ExploreRow } from '../types/explore'
import type { Filter, DateRange } from '../types/analytics'

export interface BreakdownState {
  isModalOpen: boolean
  isDrawerOpen: boolean
  selectedRow: ExploreRow | null
  breakdownDimensions: string[]
  parentFilters: Filter[]
}

interface UseBreakdownOptions {
  workspaceId: string
  dimensions: string[]
  baseFilters: Filter[]
  dateRange: DateRange
  timezone: string
  minSessions: number
}

export function useBreakdown({
  workspaceId,
  dimensions,
  baseFilters,
  dateRange,
  timezone,
  minSessions,
}: UseBreakdownOptions) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<BreakdownState | null>(null)

  // Open modal for a row
  const openForRow = useCallback((row: ExploreRow) => {
    const { filters: parentFilters } = calculateChildrenDimensionsAndFilters(
      row,
      dimensions,
      baseFilters
    )

    // Get remaining dimensions not used as parent context
    const usedDimensions = dimensions.slice(0, row.parentDimensionIndex + 1)
    const availableDimensions = dimensions.filter(d => !usedDimensions.includes(d))

    setState({
      isModalOpen: true,
      isDrawerOpen: false,
      selectedRow: row,
      breakdownDimensions: availableDimensions.slice(0, 2), // Default first 2
      parentFilters,
    })
  }, [dimensions, baseFilters])

  // Confirm modal -> open drawer (with optional new dimensions)
  const confirmWithDimensions = useCallback((dims: string[]) => {
    if (state) {
      setState({ ...state, isModalOpen: false, isDrawerOpen: true, breakdownDimensions: dims })
    }
  }, [state])

  // Close everything
  const close = useCallback(() => {
    setState(null)
  }, [])

  // Prefetch breakdown data on hover (performance optimization)
  const prefetchForRow = useCallback((row: ExploreRow) => {
    const { filters: parentFilters } = calculateChildrenDimensionsAndFilters(
      row,
      dimensions,
      baseFilters
    )

    // Prefetch first 2 available dimensions
    const usedDimensions = dimensions.slice(0, row.parentDimensionIndex + 1)
    const availableDimensions = dimensions.filter(d => !usedDimensions.includes(d))

    availableDimensions.slice(0, 2).forEach(dim => {
      queryClient.prefetchQuery({
        queryKey: ['breakdown', workspaceId, dim, parentFilters, dateRange, minSessions],
        queryFn: () => api.analytics.query({
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration', 'bounce_rate', 'max_scroll'],
          dimensions: [dim],
          filters: parentFilters,
          dateRange,
          timezone,
          order: { sessions: 'desc' },
          limit: 100,
          havingMinSessions: minSessions,
        }),
        staleTime: 60_000, // 1 minute
      })
    })
  }, [queryClient, workspaceId, dimensions, baseFilters, dateRange, timezone, minSessions])

  return {
    state,
    openForRow,
    confirmWithDimensions,
    close,
    prefetchForRow,
  }
}
