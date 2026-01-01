import { Select } from 'antd'
import type { ComparisonMode } from '../../types/dashboard'

interface ComparisonPickerProps {
  value: ComparisonMode
  onChange: (value: ComparisonMode) => void
  size?: 'small' | 'middle' | 'large'
}

const COMPARISON_OPTIONS: { value: ComparisonMode; label: string }[] = [
  { value: 'previous_period', label: 'Previous period' },
  { value: 'previous_year', label: 'Previous year' },
]

export function ComparisonPicker({ value, onChange, size }: ComparisonPickerProps) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-gray-500 text-sm">vs.</span>
      <Select
        value={value}
        onChange={onChange}
        variant="filled"
        className="min-w-32"
        popupMatchSelectWidth={false}
        options={COMPARISON_OPTIONS}
        size={size}
      />
    </div>
  )
}
