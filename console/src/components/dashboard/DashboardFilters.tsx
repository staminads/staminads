import { Select, Space } from 'antd'
import { DateRangePicker } from './DateRangePicker'
import { ComparisonPicker } from './ComparisonPicker'
import { COMMON_TIMEZONES } from '../../types/dashboard'
import type { DatePreset } from '../../types/analytics'
import type { ComparisonMode } from '../../types/dashboard'

interface DashboardFiltersProps {
  period: DatePreset
  timezone: string
  workspaceTimezone: string
  workspaceCreatedAt?: string
  comparison: ComparisonMode
  customStart?: string
  customEnd?: string
  onPeriodChange: (period: DatePreset) => void
  onTimezoneChange: (timezone: string) => void
  onComparisonChange: (comparison: ComparisonMode) => void
  onCustomRangeChange: (start: string, end: string) => void
  isPending?: boolean
}

export function DashboardFilters({
  period,
  timezone,
  workspaceTimezone,
  workspaceCreatedAt,
  comparison,
  customStart,
  customEnd,
  onPeriodChange,
  onTimezoneChange,
  onComparisonChange,
  onCustomRangeChange,
  isPending = false,
}: DashboardFiltersProps) {
  const timezoneOptions = [
    { value: workspaceTimezone, label: workspaceTimezone },
    ...COMMON_TIMEZONES.filter((tz) => tz !== workspaceTimezone).map((tz) => ({
      value: tz,
      label: tz,
    })),
  ]

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
      <div className="flex items-center gap-1">
        <span className="text-gray-500 text-sm">in</span>
        <Select
          value={timezone}
          onChange={onTimezoneChange}
          variant="filled"
          className="min-w-44"
          showSearch
          popupMatchSelectWidth={false}
          optionFilterProp="label"
          options={timezoneOptions}
        />
      </div>
    </Space>
  )
}
