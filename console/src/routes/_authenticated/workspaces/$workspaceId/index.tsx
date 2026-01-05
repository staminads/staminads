import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { DashboardGrid } from '../../../../components/dashboard/DashboardGrid'
import { DashboardFilters } from '../../../../components/dashboard/DashboardFilters'
import { ExploreFilterBuilder } from '../../../../components/explore/ExploreFilterBuilder'
import { LiveButton } from '../../../../components/live/LiveButton'
import { useDashboardParams } from '../../../../hooks/useDashboardParams'
import type { Filter } from '../../../../types/analytics'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/')({
  component: Dashboard,
})

function Dashboard() {
  const { workspaceId } = Route.useParams()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))
  const {
    period,
    timezone,
    comparison,
    customStart,
    customEnd,
    filters,
    setPeriod,
    setComparison,
    setCustomRange,
    setFilters,
    isPending,
  } = useDashboardParams(workspace.timezone)

  // Toggle filter(s) from row/cell click - removes if same value exists, adds otherwise
  const handleAddFilter = useCallback(
    (filter: Filter | Filter[]) => {
      const filtersToToggle = Array.isArray(filter) ? filter : [filter]

      // Check if ALL filters already exist with same values (for toggle off)
      const allExist = filtersToToggle.every((f) => {
        const existing = filters.find((ef) => ef.dimension === f.dimension)
        if (!existing) return false
        // Compare values arrays
        const existingValues = JSON.stringify(existing.values?.sort())
        const newValues = JSON.stringify(f.values?.sort())
        return existing.operator === f.operator && existingValues === newValues
      })

      if (allExist) {
        // Remove all matching filters (toggle off)
        const dimensionsToRemove = new Set(filtersToToggle.map((f) => f.dimension))
        setFilters(filters.filter((f) => !dimensionsToRemove.has(f.dimension)))
      } else {
        // Add/replace filters
        const dimensionsToAdd = new Set(filtersToToggle.map((f) => f.dimension))
        const newFilters = filters.filter((f) => !dimensionsToAdd.has(f.dimension))
        newFilters.push(...filtersToToggle)
        setFilters(newFilters)
      }
    },
    [filters, setFilters]
  )

  const hasFilters = filters.length > 0

  return (
    <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-light text-gray-800">Dashboard</h1>
          <LiveButton workspaceId={workspaceId} workspaceTimezone={workspace.timezone} />
        </div>
        <DashboardFilters
          period={period}
          timezone={timezone}
          workspaceCreatedAt={workspace.created_at}
          comparison={comparison}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={setPeriod}
          onComparisonChange={setComparison}
          onCustomRangeChange={setCustomRange}
          isPending={isPending}
          filters={filters}
          onFiltersChange={setFilters}
          customDimensionLabels={workspace.settings.custom_dimensions}
          hideFilterBuilder={hasFilters}
        />
      </div>
      {hasFilters && (
        <div className="mb-6 -mt-3">
          <ExploreFilterBuilder
            value={filters}
            onChange={setFilters}
            customDimensionLabels={workspace.settings.custom_dimensions}
          />
        </div>
      )}
      <DashboardGrid
        workspaceId={workspaceId}
        workspaceTimezone={workspace.timezone}
        timescoreReference={workspace.settings.timescore_reference ?? 60}
        comparison={comparison}
        customStart={customStart}
        customEnd={customEnd}
        annotations={workspace.settings.annotations}
        globalFilters={filters}
        onAddFilter={handleAddFilter}
      />
    </div>
  )
}
