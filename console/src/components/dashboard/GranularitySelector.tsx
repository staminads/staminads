import { Select } from 'antd'
import type { Granularity } from '../../types/analytics'
import { GRANULARITY_LABELS } from '../../lib/chart-utils'

interface GranularitySelectorProps {
  value: Granularity
  onChange: (granularity: Granularity) => void
  availableGranularities: Granularity[]
}

export function GranularitySelector({
  value,
  onChange,
  availableGranularities,
}: GranularitySelectorProps) {
  // Don't render if only one option available
  if (availableGranularities.length <= 1) {
    return null
  }

  return (
    <Select
      size="small"
      value={value}
      onChange={onChange}
      options={availableGranularities.map((g) => ({
        value: g,
        label: GRANULARITY_LABELS[g],
      }))}
      className="w-24"
      popupMatchSelectWidth={false}
    />
  )
}
