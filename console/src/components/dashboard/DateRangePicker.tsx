import { Fragment, useState, useEffect } from 'react'
import { Dropdown, Button, Divider, Modal, DatePicker, message } from 'antd'
import { DownOutlined, CheckOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { PRESET_GROUPS, PERIOD_LABELS } from '../../types/dashboard'
import { computeDateRange, formatDateRangeLabel, validateDateRange } from '../../lib/date-utils'
import type { DatePreset } from '../../types/analytics'

const { RangePicker } = DatePicker

// Presets that should show their label instead of computed date range
const LABEL_PRESETS: DatePreset[] = [
  'today',
  'yesterday',
  'last_7_days',
  'last_14_days',
  'last_28_days',
  'last_30_days',
  'last_90_days',
  'last_91_days',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_12_months',
  'all_time',
]

interface DateRangePickerProps {
  period: DatePreset
  timezone: string
  workspaceCreatedAt?: string
  customStart?: string
  customEnd?: string
  onPeriodChange: (period: DatePreset) => void
  onCustomRangeChange: (start: string, end: string) => void
  size?: 'small' | 'middle' | 'large'
}

export function DateRangePicker({
  period,
  timezone,
  workspaceCreatedAt,
  customStart,
  customEnd,
  onPeriodChange,
  onCustomRangeChange,
  size,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<[Dayjs, Dayjs] | null>(null)

  // Compute the date range for display
  const customRange = customStart && customEnd ? { start: customStart, end: customEnd } : undefined
  const dateRange = computeDateRange(period, timezone, customRange, workspaceCreatedAt)

  // Show label for relative presets, computed range for others
  const displayLabel = LABEL_PRESETS.includes(period)
    ? PERIOD_LABELS[period]
    : formatDateRangeLabel(dateRange.start, dateRange.end)

  // Debounce custom range changes
  useEffect(() => {
    if (!pendingRange) return
    const timer = setTimeout(() => {
      const [start, end] = pendingRange
      const error = validateDateRange(start, end)
      if (error) {
        message.error(error)
        setPendingRange(null)
        return
      }
      onCustomRangeChange(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'))
      setPendingRange(null)
      setCustomModalOpen(false)
    }, 500)
    return () => clearTimeout(timer)
  }, [pendingRange, onCustomRangeChange])

  const handleSelect = (preset: DatePreset) => {
    if (preset === 'custom') {
      setCustomModalOpen(true)
      setOpen(false)
    } else {
      onPeriodChange(preset)
      setOpen(false)
    }
  }

  const handleCustomRangeOk = () => {
    if (pendingRange) {
      const [start, end] = pendingRange
      const error = validateDateRange(start, end)
      if (error) {
        message.error(error)
        return
      }
      onCustomRangeChange(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'))
      onPeriodChange('custom')
      setCustomModalOpen(false)
      setPendingRange(null)
    }
  }

  const dropdownContent = (
    <div className="bg-white rounded-lg shadow-lg p-1 min-w-52">
      {PRESET_GROUPS.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {group.map((preset) => (
            <div
              key={preset}
              onClick={() => handleSelect(preset)}
              className={`
                flex items-center justify-between px-3 py-2 rounded cursor-pointer
                hover:bg-gray-100 transition-colors
                ${period === preset ? 'bg-gray-100 font-medium' : ''}
              `}
            >
              <span>{PERIOD_LABELS[preset]}</span>
              {period === preset && (
                <CheckOutlined className="text-[var(--primary)] text-xs" />
              )}
            </div>
          ))}
          {groupIndex < PRESET_GROUPS.length - 1 && (
            <Divider className="my-1" style={{ margin: '4px 0' }} />
          )}
        </Fragment>
      ))}
    </div>
  )

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        trigger={['click']}
        dropdownRender={() => dropdownContent}
        placement="bottomLeft"
      >
        <Button variant="filled" color="default" size={size} className="flex items-center gap-2">
          <span>{displayLabel}</span>
          <DownOutlined className="text-gray-400 text-xs" />
        </Button>
      </Dropdown>

      <Modal
        title="Select Custom Date Range"
        open={customModalOpen}
        onCancel={() => {
          setCustomModalOpen(false)
          setPendingRange(null)
        }}
        onOk={handleCustomRangeOk}
        okText="Apply"
        okButtonProps={{ disabled: !pendingRange }}
      >
        <div className="py-4">
          <RangePicker
            value={pendingRange}
            onChange={(dates) => setPendingRange(dates as [Dayjs, Dayjs] | null)}
            disabledDate={(current) => current && current > dayjs().endOf('day')}
            className="w-full"
            format="D MMM YYYY"
          />
          <p className="text-gray-500 text-sm mt-2">
            Maximum range is 2 years. End date cannot be in the future.
          </p>
        </div>
      </Modal>
    </>
  )
}
