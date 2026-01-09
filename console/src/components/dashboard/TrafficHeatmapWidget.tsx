import { useState, useMemo, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsReactProps } from 'echarts-for-react'
import { Spin, Empty } from 'antd'
import { formatValue } from '../../lib/chart-utils'

type TabKey = 'sessions' | 'median_duration'

export interface HeatmapTab {
  key: TabKey
  label: string
}

const DEFAULT_TABS: HeatmapTab[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'median_duration', label: 'TimeScore' },
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = [
  '12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
  '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p',
]

export interface HeatmapDataPoint {
  day_of_week: number // 1-7 (Mon-Sun, ClickHouse ISO standard)
  hour: number // 0-23
  sessions: number
  median_duration: number
}

interface TrafficHeatmapWidgetProps {
  title: string
  data: HeatmapDataPoint[]
  loading: boolean
  timescoreReference?: number
  emptyText?: string
  onCellClick?: (dayOfWeek: number, hour: number) => void
  /** Custom tab configuration. Defaults to Sessions and TimeScore tabs. */
  tabs?: HeatmapTab[]
}

// Get heat map color based on value relative to reference (same logic as CountriesMapWidget)
function getTimescoreColor(value: number, maxValue: number, reference: number): string {
  if (!maxValue || value <= 0) return '#f5f5f5' // Light gray for zero/empty

  const effectiveMax = Math.max(maxValue, reference)

  if (value <= reference) {
    // Below/at reference: light → green
    const ratio = value / reference
    const lightness = 95 - ratio * 30 // 95% → 65%
    return `hsl(142, 50%, ${lightness}%)`
  } else {
    // Above reference: green → cyan
    const headroom = effectiveMax - reference
    if (headroom <= 0) {
      return `hsl(180, 50%, 55%)`
    }
    const aboveRatio = Math.min((value - reference) / headroom, 1)
    const hue = 142 + aboveRatio * 38 // 142 → 180 (cyan)
    const lightness = 65 - aboveRatio * 10 // 65% → 55%
    return `hsl(${hue}, 50%, ${lightness}%)`
  }
}

// Transform API data to ECharts heatmap format
function transformToHeatmapData(
  data: HeatmapDataPoint[],
  metric: TabKey
): [number, number, number][] {
  // Initialize 7x24 grid with zeros
  const grid: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  )

  // Fill grid with data
  for (const point of data) {
    const dayIndex = point.day_of_week - 1 // Convert 1-7 to 0-6
    const hourIndex = point.hour
    if (dayIndex >= 0 && dayIndex < 7 && hourIndex >= 0 && hourIndex < 24) {
      grid[dayIndex][hourIndex] = point[metric]
    }
  }

  // Convert to ECharts format: [hourIndex, dayIndex, value]
  const result: [number, number, number][] = []
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      result.push([hour, day, grid[day][hour]])
    }
  }
  return result
}

export function TrafficHeatmapWidget({
  title,
  data,
  loading,
  timescoreReference = 60,
  emptyText = 'No data available',
  onCellClick,
  tabs = DEFAULT_TABS,
}: TrafficHeatmapWidgetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]?.key ?? 'sessions')

  // Transform data for ECharts
  const heatmapData = useMemo(
    () => transformToHeatmapData(data, activeTab),
    [data, activeTab]
  )

  // Find max value for the active tab
  const maxValue = useMemo(() => {
    if (heatmapData.length === 0) return 1
    return Math.max(...heatmapData.map((d) => d[2]))
  }, [heatmapData])

  // Build ECharts option
  const option = useMemo(() => {
    const isTimescore = activeTab === 'median_duration'

    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        textStyle: { color: '#374151', fontSize: 12 },
        formatter: (params: { data?: [number, number, number] }) => {
          if (!params.data) return ''
          const [hourIndex, dayIndex, value] = params.data
          const dayName = DAYS[dayIndex]
          const hourLabel = HOURS[hourIndex]
          const format = isTimescore ? 'duration' : 'number'
          const formatted = formatValue(value, format as 'number' | 'duration')
          const activeTabLabel = tabs.find(t => t.key === activeTab)?.label ?? activeTab
          return `<div style="font-weight: 500">${dayName} ${hourLabel}</div><div>${activeTabLabel}: ${formatted}</div>`
        },
      },
      grid: {
        left: 50,
        right: 20,
        top: 20,
        bottom: 40,
      },
      xAxis: {
        type: 'category',
        data: HOURS,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: {
          color: '#6b7280',
          fontSize: 10,
          interval: 2, // Show every 3rd hour
        },
      },
      yAxis: {
        type: 'category',
        data: DAYS,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 10 },
      },
      visualMap: isTimescore
        ? {
            // For TimeScore, colors are set per-item via itemStyle
            show: false,
          }
        : {
            // Purple gradient for sessions
            min: 0,
            max: maxValue || 1,
            show: false,
            inRange: {
              color: [
                '#f5f5f5', // Light gray for zero
                'rgba(119, 99, 241, 0.2)',
                'rgba(119, 99, 241, 0.4)',
                'rgba(119, 99, 241, 0.6)',
                'rgba(119, 99, 241, 0.8)',
                'rgba(119, 99, 241, 1)',
              ],
            },
          },
      series: [
        {
          type: 'heatmap',
          data: isTimescore
            ? heatmapData.map(([x, y, v]) => ({
                value: [x, y, v],
                itemStyle: {
                  color: getTimescoreColor(v, maxValue, timescoreReference),
                },
              }))
            : heatmapData,
          emphasis: {
            itemStyle: { borderColor: '#7763f1', borderWidth: 2 },
          },
          label: { show: false },
        },
      ],
    }
  }, [heatmapData, maxValue, activeTab, timescoreReference, tabs])

  // Handle heatmap cell click
  const handleChartClick = useCallback(
    (params: { data?: [number, number, number] | { value: [number, number, number] } }) => {
      if (!onCellClick || !params.data) return
      // Data can be [x, y, value] or { value: [x, y, value] } depending on series format
      const dataArray = Array.isArray(params.data) ? params.data : params.data.value
      const [hourIndex, dayIndex] = dataArray
      // Convert dayIndex (0-6) to day_of_week (1-7 for ClickHouse ISO standard)
      const dayOfWeek = dayIndex + 1
      onCellClick(dayOfWeek, hourIndex)
    },
    [onCellClick]
  )

  const onEvents: EChartsReactProps['onEvents'] = useMemo(
    () => (onCellClick ? { click: handleChartClick } : undefined),
    [onCellClick, handleChartClick]
  )

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Title */}
      <div className="px-4 pt-4 pb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>

      {/* Tabs (only show if multiple tabs) */}
      {tabs.length > 1 && (
        <div className="flex gap-4 px-4 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-2 text-xs transition-colors border-b-2 -mb-px cursor-pointer ${
                activeTab === tab.key
                  ? 'text-gray-900 border-[var(--primary)]'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Heatmap */}
      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spin />
        </div>
      ) : data.length === 0 ? (
        <Empty
          description={emptyText}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 300, cursor: onCellClick ? 'pointer' : 'default' }}
          opts={{ renderer: 'svg' }}
          onEvents={onEvents}
        />
      )}
    </div>
  )
}
