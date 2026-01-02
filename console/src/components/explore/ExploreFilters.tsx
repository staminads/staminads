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
    <div className="flex flex-wrap items-center gap-4 mb-6">
      {/* Dimension Selector */}
      <DimensionSelector value={dimensions} onChange={onDimensionsChange} customDimensionLabels={customDimensionLabels} />

      {/* Divider */}
      <div className="h-6 w-px bg-gray-200" />

      {/* Manual Filters */}
      <ExploreFilterBuilder value={filters} onChange={onFiltersChange} customDimensionLabels={customDimensionLabels} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Min Sessions */}
      <MinSessionsInput value={minSessions} onChange={onMinSessionsChange} />
    </div>
  )
}
