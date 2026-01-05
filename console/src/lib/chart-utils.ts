import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { EChartsOption } from 'echarts'
import type { DatePreset, Granularity } from '../types/analytics'
import type { ChartDataPoint, MetricConfig } from '../types/dashboard'
import type { Annotation } from '../types/workspace'

dayjs.extend(isBetween)
dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Determine appropriate granularity based on date preset
 */
export function determineGranularity(preset: DatePreset): Granularity {
  const granularityMap: Record<DatePreset, Granularity> = {
    previous_30_minutes: 'hour',
    today: 'hour',
    yesterday: 'hour',
    previous_7_days: 'day',
    previous_14_days: 'day',
    previous_28_days: 'day',
    previous_30_days: 'day',
    previous_90_days: 'week',
    previous_91_days: 'week',
    this_week: 'day',
    previous_week: 'day',
    this_month: 'day',
    previous_month: 'day',
    this_quarter: 'week',
    previous_quarter: 'week',
    this_year: 'month',
    previous_year: 'month',
    previous_12_months: 'month',
    all_time: 'month',
    custom: 'day' // Will be overridden by determineGranularityForRange for custom ranges
  }
  return granularityMap[preset]
}

/**
 * Get available granularities based on date range span
 * Used for the granularity selector UI
 */
export function getAvailableGranularities(days: number): Granularity[] {
  if (days <= 2) return ['hour']
  if (days <= 7) return ['hour', 'day']
  if (days <= 30) return ['day', 'week']
  if (days <= 90) return ['day', 'week', 'month']
  return ['week', 'month']
}

/**
 * Labels for granularity options in the UI
 */
export const GRANULARITY_LABELS: Record<Granularity, string> = {
  hour: 'Hourly',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly',
}

/**
 * Format a value based on metric type (for tooltips - full format)
 */
export function formatValue(value: number, format: MetricConfig['format']): string {
  switch (format) {
    case 'duration':
      return formatDuration(value)
    case 'percentage':
      return `${value.toFixed(1)}%`
    case 'number':
    default:
      return formatNumber(value)
  }
}

/**
 * Format a value for axis labels (compact format)
 */
export function formatAxisValue(value: number, format: MetricConfig['format']): string {
  switch (format) {
    case 'duration':
      // Compact: 90 -> "90s", 150 -> "2.5m"
      if (value < 60) return `${Math.round(value)}s`
      return `${(value / 60).toFixed(1)}m`
    case 'percentage':
      return `${Math.round(value)}%`
    case 'number':
    default:
      return formatNumber(value)
  }
}

/**
 * Format duration in seconds to human readable format
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/**
 * Format number with compact notation for large values
 */
export function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toFixed(0)
}

/**
 * Format X-axis label based on granularity
 * Uses dayjs for reliable parsing of "YYYY-MM-DD HH:00:00" format
 */
export function formatXAxisLabel(timestamp: string, granularity: Granularity): string {
  if (!timestamp) return ''

  const date = dayjs(timestamp)
  if (!date.isValid()) return timestamp

  switch (granularity) {
    case 'hour':
      return date.format('ha') // "9am"
    case 'day':
    case 'week':
      return date.format('MMM D') // "Dec 21"
    case 'month':
      return date.format("MMM 'YY") // "Dec '25"
    case 'year':
      return date.format('YYYY')
    default:
      return timestamp
  }
}

/**
 * Find the data point label for an annotation date/time.
 * Finds the first data point on or after the annotation datetime to ensure
 * the annotation appears at the start of the event, not at the peak.
 * This is required for ECharts category axis positioning.
 */
function findDataPointLabelForAnnotation(
  annotationDate: string,
  annotationTime: string,
  currentData: ChartDataPoint[],
  granularity: Granularity,
  annotationTimezone: string,
  workspaceTimezone: string
): string {
  // Parse annotation in its own timezone, then convert to workspace timezone for comparison
  const annDateTime = dayjs.tz(`${annotationDate} ${annotationTime}`, annotationTimezone)

  // Find the first data point on or after the annotation datetime
  for (const point of currentData) {
    // Data points are in workspace timezone
    const pointDate = dayjs.tz(point.timestamp, workspaceTimezone)
    if (pointDate.isSame(annDateTime, 'hour') || pointDate.isAfter(annDateTime, 'hour')) {
      return formatXAxisLabel(point.timestamp, granularity)
    }
  }

  // Fallback: if annotation is after all data points, use the last one
  return formatXAxisLabel(currentData[currentData.length - 1].timestamp, granularity)
}

/**
 * Format date range for legend labels
 * Uses dayjs for reliable parsing
 */
export function formatDateRange(start: string, end: string): string {
  if (!start || !end) return ''

  const startDate = dayjs(start)
  const endDate = dayjs(end)

  if (!startDate.isValid() || !endDate.isValid()) return ''

  const startMonth = startDate.format('MMM')
  const endMonth = endDate.format('MMM')
  const startDay = startDate.date()
  const endDay = endDate.date()

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`
}

/**
 * Create ECharts option for metric chart with optional comparison
 */
export function createMetricChartOption(
  metric: MetricConfig,
  currentData: ChartDataPoint[],
  previousData: ChartDataPoint[],
  granularity: Granularity,
  currentLabel: string,
  previousLabel: string,
  annotations?: Annotation[],
  workspaceTimezone?: string
): EChartsOption {
  const xAxisData = currentData.map((d) => formatXAxisLabel(d.timestamp, granularity))
  const currentValues = currentData.map((d) => d.value)
  const previousValues = previousData.map((d) => d.value)
  const dataLength = currentData.length
  const hasComparison = previousData.length > 0

  // Calculate label interval to prevent overlap
  const labelInterval = dataLength > 14 ? Math.floor(dataLength / 7) - 1 : 0
  const labelRotate = dataLength > 20 ? 45 : 0

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      textStyle: {
        color: '#374151',
        fontSize: 12
      },
      formatter: (params: unknown) => {
        const p = params as { axisValue: string; value: number; seriesName: string }[]
        if (!Array.isArray(p) || p.length === 0) return ''

        const currentVal = p[0]?.value ?? 0

        if (!hasComparison) {
          return `
            <div style="font-weight: 500; margin-bottom: 4px;">${p[0].axisValue}</div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #7763f1;">${metric.label}:</span>
              <span style="font-weight: 600;">${formatValue(currentVal, metric.format)}</span>
            </div>
          `
        }

        const previousVal = p[1]?.value ?? 0
        const delta = previousVal !== 0 ? ((currentVal - previousVal) / previousVal) * 100 : 0
        const sign = delta >= 0 ? '+' : ''
        const deltaColor = (metric.invertTrend ? delta <= 0 : delta >= 0) ? '#10b981' : '#ef4444'

        return `
          <div style="font-weight: 500; margin-bottom: 4px;">${p[0].axisValue}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: ${metric.color};">${metric.label}:</span>
            <span style="font-weight: 600;">${formatValue(currentVal, metric.format)}</span>
            <span style="color: #9ca3af;">vs ${formatValue(previousVal, metric.format)}</span>
            <span style="color: ${deltaColor}; font-weight: 500;">(${sign}${delta.toFixed(1)}%)</span>
          </div>
        `
      }
    },
    legend: {
      show: false
    },
    grid: {
      left: '1%',
      right: '1%',
      bottom: labelRotate > 0 ? '10%' : '5%',
      top: annotations?.length ? '18%' : '5%', // Extra space for annotation labels
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: xAxisData,
      axisLine: {
        lineStyle: { color: '#e5e7eb' }
      },
      axisLabel: {
        color: '#6b7280',
        fontSize: 10,
        interval: labelInterval,
        rotate: labelRotate
      },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: {
        lineStyle: { color: '#f3f4f6' }
      },
      axisLabel: {
        color: '#6b7280',
        fontSize: 10,
        formatter: (value: number) => formatAxisValue(value, metric.format)
      }
    },
    series: [
      {
        name: currentLabel,
        type: 'line',
        smooth: 0.3,
        symbol: 'none',
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#7763f140' },
              { offset: 1, color: '#7763f105' }
            ]
          }
        },
        lineStyle: {
          color: '#7763f1',
          width: 2
        },
        data: currentValues,
        // Annotations as vertical dashed lines
        markLine: annotations?.length
          ? {
              silent: false,
              symbol: ['none', 'none'],
              emphasis: {
                lineStyle: {
                  width: 2,
                  opacity: 1
                }
              },
              tooltip: {
                show: true,
                trigger: 'item',
                formatter: ((params: { data: { annotation?: Annotation } }) => {
                  const ann = params.data?.annotation
                  if (!ann) return ''
                  const bulletColor = ann.color || '#7763f1'
                  return `
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 4px;">
                      <span style="color: ${bulletColor}; font-size: 14px;">●</span>
                      ${ann.title}
                    </div>
                    <div style="color: #6b7280; font-size: 11px;">${ann.date} ${ann.time} (${ann.timezone})</div>
                    ${ann.description ? `<div style="margin-top: 8px;">${ann.description}</div>` : ''}
                  `
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }) as any
              },
              data: annotations
                .filter((a) => {
                  // Filter annotations within the current date range
                  if (currentData.length < 2) return false
                  const firstTimestamp = currentData[0]?.timestamp
                  const lastTimestamp = currentData[currentData.length - 1]?.timestamp
                  if (!firstTimestamp || !lastTimestamp) return false
                  // Use annotation's own timezone (or fallback to workspace timezone)
                  const tz = a.timezone || workspaceTimezone!
                  const annotationDate = dayjs.tz(a.date, tz)
                  const dataStart = dayjs.tz(firstTimestamp, tz)
                  const dataEnd = dayjs.tz(lastTimestamp, tz)
                  if (!dataStart.isValid() || !dataEnd.isValid()) return false
                  return annotationDate.isBetween(dataStart, dataEnd, 'day', '[]')
                })
                .map((a, index) => {
                  const tz = a.timezone || workspaceTimezone!
                  const bulletColor = a.color || '#7763f1'
                  // Truncate long titles for the always-visible label
                  const shortTitle = a.title.length > 20 ? a.title.slice(0, 20) + '…' : a.title
                  return {
                    xAxis: findDataPointLabelForAnnotation(a.date, a.time, currentData, granularity, tz, workspaceTimezone!),
                    annotation: a,
                    lineStyle: {
                      color: '#000',
                      type: 'dotted' as const,
                      width: 1
                    },
                    label: {
                      show: true,
                      formatter: `{bullet|●} {title|${shortTitle}}`,
                      // Stagger positioning: alternate top/bottom for readability
                      position: index % 2 === 0 ? 'insideEndTop' : 'insideEndBottom',
                      rotate: 0, // Horizontal text
                      backgroundColor: 'rgba(0, 0, 0, 0.45)',
                      padding: [4, 6, 2, 6] as [number, number, number, number],
                      borderRadius: 4,
                      rich: {
                        bullet: {
                          color: bulletColor,
                          fontSize: 12,
                          lineHeight: 12
                        },
                        title: {
                          color: '#fff',
                          fontSize: 11,
                          lineHeight: 12
                        }
                      }
                    }
                  }
                })
            }
          : undefined
      },
      ...(hasComparison
        ? [
            {
              name: previousLabel,
              type: 'line' as const,
              smooth: 0.3,
              symbol: 'none' as const,
              areaStyle: {
                color: {
                  type: 'linear' as const,
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: '#9ca3af30' },
                    { offset: 1, color: '#9ca3af05' }
                  ]
                }
              },
              lineStyle: {
                color: '#9ca3af',
                width: 1,
                type: 'solid' as const
              },
              data: previousValues
            }
          ]
        : [])
    ]
  }
}
