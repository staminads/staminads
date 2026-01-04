import dayjs from 'dayjs'
import { formatDuration } from './chart-utils'
import { getDimensionLabel } from './explore-utils'
import type { CustomDimensionLabels } from '../types/workspace'

/**
 * Escape CSV value per RFC 4180
 */
export function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const stringValue = String(value)
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

/**
 * Generate CSV headers
 */
export function generateCSVHeaders(
  dimensions: string[],
  showComparison: boolean,
  customDimensionLabels?: CustomDimensionLabels | null
): string[] {
  const headers = [
    ...dimensions.map(d => getDimensionLabel(d, customDimensionLabels)),
    'Sessions',
    'Sessions (%)',
    'TimeScore',
    'TimeScore (seconds)',
    'Bounce Rate (%)',
    'Median Scroll Depth (%)',
  ]

  if (showComparison) {
    headers.push(
      'Sessions (Previous)',
      'Sessions (Change %)',
      'TimeScore (Previous)',
      'TimeScore (Change %)',
      'Bounce Rate (Previous)',
      'Bounce Rate (Change %)',
      'Median Scroll Depth (Previous)',
      'Median Scroll Depth (Change %)'
    )
  }

  return headers
}

/**
 * Convert API row to CSV values
 */
export function rowToCSVValues(
  row: Record<string, unknown>,
  dimensions: string[],
  totalSessions: number,
  showComparison: boolean
): string[] {
  const sessions = Number(row.sessions) || 0
  const medianDuration = Number(row.median_duration) || 0
  const bounceRate = Number(row.bounce_rate) || 0
  const medianScroll = Number(row.median_scroll) || 0

  const sessionPercent = totalSessions > 0
    ? ((sessions / totalSessions) * 100).toFixed(2)
    : '0'

  const values = [
    ...dimensions.map(d => {
      const val = row[d]
      return val === null || val === undefined || val === '' ? '(empty)' : String(val)
    }),
    String(sessions),
    sessionPercent,
    formatDuration(medianDuration),
    medianDuration.toFixed(2),
    bounceRate.toFixed(2),
    medianScroll.toFixed(2),
  ]

  if (showComparison) {
    const sessionsPrev = row.sessions_prev !== undefined ? Number(row.sessions_prev) : null
    const durationPrev = row.median_duration_prev !== undefined ? Number(row.median_duration_prev) : null
    const bouncePrev = row.bounce_rate_prev !== undefined ? Number(row.bounce_rate_prev) : null
    const scrollPrev = row.median_scroll_prev !== undefined ? Number(row.median_scroll_prev) : null

    values.push(
      sessionsPrev !== null ? String(sessionsPrev) : '',
      row.sessions_change !== undefined ? Number(row.sessions_change).toFixed(2) : '',
      durationPrev !== null ? formatDuration(durationPrev) : '',
      row.median_duration_change !== undefined ? Number(row.median_duration_change).toFixed(2) : '',
      bouncePrev !== null ? bouncePrev.toFixed(2) : '',
      row.bounce_rate_change !== undefined ? Number(row.bounce_rate_change).toFixed(2) : '',
      scrollPrev !== null ? scrollPrev.toFixed(2) : '',
      row.median_scroll_change !== undefined ? Number(row.median_scroll_change).toFixed(2) : ''
    )
  }

  return values
}

/**
 * Generate full CSV string
 */
export function generateCSV(
  rows: Record<string, unknown>[],
  dimensions: string[],
  totalSessions: number,
  showComparison: boolean,
  customDimensionLabels?: CustomDimensionLabels | null
): string {
  const headers = generateCSVHeaders(dimensions, showComparison, customDimensionLabels)

  const csvLines = [
    headers.map(escapeCSVValue).join(','),
    ...rows.map(row =>
      rowToCSVValues(row, dimensions, totalSessions, showComparison)
        .map(escapeCSVValue)
        .join(',')
    )
  ]

  return csvLines.join('\n')
}

/**
 * Trigger browser download
 */
export function downloadCSV(content: string, filename?: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `explore-report-${dayjs().format('YYYY-MM-DD')}.csv`
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}
