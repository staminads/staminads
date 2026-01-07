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
    <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-4 mb-6">
      <div className="flex items-center gap-4">
        {/* Dimension Selector */}
        <DimensionSelector value={dimensions} onChange={onDimensionsChange} customDimensionLabels={customDimensionLabels} />

        {/* Divider - hidden on mobile */}
        <div className="hidden md:block h-6 w-px bg-gray-200" />
      </div>

      {/* Manual Filters - own line on mobile */}
      <ExploreFilterBuilder value={filters} onChange={onFiltersChange} customDimensionLabels={customDimensionLabels} />

      {/* Spacer */}
      <div className="hidden md:block flex-1" />

      {/* Min Sessions */}
      <MinSessionsInput value={minSessions} onChange={onMinSessionsChange} />
    </div>
  )
}
