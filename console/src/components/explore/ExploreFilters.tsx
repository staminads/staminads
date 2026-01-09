import { DimensionSelector } from './DimensionSelector'
import { MinSessionsInput } from './MinSessionsInput'
import { ExploreFilterBuilder } from './ExploreFilterBuilder'
import type { Filter } from '../../types/analytics'
import type { CustomDimensionLabels } from '../../types/workspace'

interface ExploreFiltersProps {
  // Dimension selection
  dimensions: string[]
  onDimensionsChange: (dimensions: string[]) => void

  // Filter selection
  filters: Filter[]
  onFiltersChange: (filters: Filter[]) => void

  // Min sessions
  minSessions: number
  onMinSessionsChange: (minSessions: number) => void

  // Custom dimension labels from workspace settings
  customDimensionLabels?: CustomDimensionLabels | null
}

export function ExploreFilters({
  dimensions,
  onDimensionsChange,
  filters,
  onFiltersChange,
  minSessions,
  onMinSessionsChange,
  customDimensionLabels,
}: ExploreFiltersProps) {
  return (
    <div className="flex flex-col gap-4 mb-6">
      {/* First row: Dimensions + Min Sessions */}
      <div className="flex flex-wrap items-center gap-4">
        <DimensionSelector value={dimensions} onChange={onDimensionsChange} customDimensionLabels={customDimensionLabels} />
        <div className="hidden md:block flex-1" />
        <MinSessionsInput value={minSessions} onChange={onMinSessionsChange} />
      </div>

      {/* Second row: Filters */}
      <ExploreFilterBuilder value={filters} onChange={onFiltersChange} customDimensionLabels={customDimensionLabels} />
    </div>
  )
}
