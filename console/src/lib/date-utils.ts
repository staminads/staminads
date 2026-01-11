import dayjs, { Dayjs } from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import type { DatePreset, Granularity } from '../types/analytics'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(quarterOfYear)

export interface DateRange {
  start: Dayjs
  end: Dayjs
}

export function computeDateRange(
  preset: DatePreset,
  tz: string,
  customRange?: { start: string; end: string },
  workspaceCreatedAt?: string,
): DateRange {
  const now = dayjs().tz(tz)

  switch (preset) {
    case 'today':
      return { start: now.startOf('day'), end: now }
    case 'yesterday':
      return {
        start: now.subtract(1, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'previous_7_days':
      return {
        start: now.subtract(7, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'previous_14_days':
      return {
        start: now.subtract(14, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'previous_28_days':
      return {
        start: now.subtract(28, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'previous_30_days':
      return {
        start: now.subtract(30, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'previous_90_days':
      return {
        start: now.subtract(90, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'previous_91_days':
      return {
        start: now.subtract(91, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
    case 'this_week':
      return { start: now.startOf('week'), end: now }
    case 'previous_week':
      return {
        start: now.subtract(1, 'week').startOf('week'),
        end: now.subtract(1, 'week').endOf('week'),
      }
    case 'this_month':
      return { start: now.startOf('month'), end: now }
    case 'previous_month':
      return {
        start: now.subtract(1, 'month').startOf('month'),
        end: now.subtract(1, 'month').endOf('month'),
      }
    case 'this_quarter':
      return { start: now.startOf('quarter'), end: now }
    case 'previous_quarter':
      return {
        start: now.subtract(1, 'quarter').startOf('quarter'),
        end: now.subtract(1, 'quarter').endOf('quarter'),
      }
    case 'this_year':
      return { start: now.startOf('year'), end: now }
    case 'previous_year':
      return {
        start: now.subtract(1, 'year').startOf('year'),
        end: now.subtract(1, 'year').endOf('year'),
      }
    case 'previous_12_months':
      return { start: now.subtract(12, 'month').startOf('month'), end: now }
    case 'all_time':
      return {
        start: workspaceCreatedAt ? dayjs(workspaceCreatedAt).tz(tz) : dayjs('2020-01-01').tz(tz),
        end: now,
      }
    case 'custom':
      if (!customRange) {
        return {
          start: now.subtract(7, 'day').startOf('day'),
          end: now.subtract(1, 'day').endOf('day'),
        }
      }
      return {
        start: dayjs(customRange.start).tz(tz),
        end: dayjs(customRange.end).tz(tz),
      }
    default:
      return {
        start: now.subtract(7, 'day').startOf('day'),
        end: now.subtract(1, 'day').endOf('day'),
      }
  }
}

export function computeComparisonRange(
  start: Dayjs,
  end: Dayjs,
  mode: 'previous_period' | 'previous_year',
): DateRange {
  if (mode === 'previous_year') {
    return {
      start: start.subtract(1, 'year'),
      end: end.subtract(1, 'year'),
    }
  }
  // Previous period: shift back by the period length + 1 day
  const days = end.diff(start, 'day')
  return {
    start: start.subtract(days + 1, 'day'),
    end: start.subtract(1, 'day'),
  }
}

export function formatDateRangeLabel(start: Dayjs, end: Dayjs): string {
  const sameDay = start.isSame(end, 'day')
  const sameMonth = start.month() === end.month()
  const sameYear = start.year() === end.year()

  if (sameDay) {
    return start.format('D MMM')
  }
  if (sameMonth && sameYear) {
    return `${start.format('D')} - ${end.format('D MMM')}`
  }
  if (sameYear) {
    return `${start.format('D MMM')} - ${end.format('D MMM')}`
  }
  return `${start.format('D MMM YY')} - ${end.format('D MMM YY')}`
}

export function validateDateRange(start: Dayjs, end: Dayjs): string | null {
  if (end.isBefore(start)) {
    return 'End date must be after start date'
  }
  if (end.diff(start, 'day') > 730) {
    return 'Maximum range is 2 years'
  }
  if (end.isAfter(dayjs())) {
    return 'End date cannot be in the future'
  }
  return null
}

export function determineGranularityForRange(start: Dayjs, end: Dayjs): Granularity {
  const days = end.diff(start, 'day')
  if (days <= 2) return 'hour'
  if (days <= 120) return 'day' // < 4 months: use daily
  return 'month'
}
