import { Button, Dropdown } from 'antd'
import { Bell } from 'lucide-react'
import { DateRangePicker } from './DateRangePicker'
import { ComparisonPicker } from './ComparisonPicker'
import { ExploreFilterBuilder } from '../explore/ExploreFilterBuilder'
import type { DatePreset, Filter } from '../../types/analytics'
import type { ComparisonMode } from '../../types/dashboard'
import type { CustomDimensionLabels } from '../../types/workspace'

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
  filters: Filter[]
  onFiltersChange: (filters: Filter[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
  hideFilterBuilder?: boolean
  onSubscribeClick?: () => void
  onViewSubscriptions?: () => void
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
  filters,
  onFiltersChange,
  customDimensionLabels,
  hideFilterBuilder = false,
  onSubscribeClick,
  onViewSubscriptions,
}: DashboardFiltersProps) {
  return (
    <div className={`flex flex-col md:flex-row md:items-center gap-2 ${isPending ? 'opacity-75 transition-opacity' : ''}`}>
      {!hideFilterBuilder && (
        <div className="order-2 md:order-1">
          <ExploreFilterBuilder
            value={filters}
            onChange={onFiltersChange}
            customDimensionLabels={customDimensionLabels}
          />
        </div>
      )}
      <div className="flex items-center gap-2 mb-2 md:mb-0 order-1 md:order-2">
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
        {onSubscribeClick && (
          <Dropdown
            menu={{
              items: [
                { key: 'create', label: 'Create subscription', onClick: onSubscribeClick },
                { key: 'view', label: 'View subscriptions', onClick: onViewSubscriptions },
              ],
            }}
            trigger={['click']}
          >
            <Button
              type="primary"
              ghost
              icon={<Bell className="w-4 h-4" />}
            />
          </Dropdown>
        )}
      </div>
    </div>
  )
}
