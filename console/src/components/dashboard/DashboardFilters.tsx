import { Space } from 'antd'
import { DateRangePicker } from './DateRangePicker'
import { ComparisonPicker } from './ComparisonPicker'
import type { DatePreset } from '../../types/analytics'
import type { ComparisonMode } from '../../types/dashboard'

interface DashboardFiltersProps {
  period: DatePreset
  timezone: string
  workspaceCreatedAt?: string
  comparison: ComparisonMode
  customStart?: string
  customEnd?: string
  onPeriodChange: (period: DatePreset) => void
  onComparisonChange: (comparison: ComparisonMode) => void
  onCustomRangeChange: (start: string, end: string) => void
  isPending?: boolean
}

export function DashboardFilters({
  period,
  timezone,
  workspaceCreatedAt,
  comparison,
  customStart,
  customEnd,
  onPeriodChange,
  onComparisonChange,
  onCustomRangeChange,
  isPending = false,
}: DashboardFiltersProps) {
  return (
    <Space size="small" className={isPending ? 'opacity-75 transition-opacity' : ''}>
      <DateRangePicker
        period={period}
        timezone={timezone}
        workspaceCreatedAt={workspaceCreatedAt}
        customStart={customStart}
        customEnd={customEnd}
        onPeriodChange={onPeriodChange}
        onCustomRangeChange={onCustomRangeChange}
      />
      <ComparisonPicker value={comparison} onChange={onComparisonChange} />
    </Space>
  )
}
