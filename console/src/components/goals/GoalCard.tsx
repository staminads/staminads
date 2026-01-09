import { useState } from 'react'
import { Card, Statistic, Button } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { ChevronUp, ChevronDown } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import tz from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import type { EChartsOption } from 'echarts'
import { formatNumber, formatCurrency, formatXAxisLabel } from '../../lib/chart-utils'
import type { ChartDataPoint } from '../../types/dashboard'
import type { Granularity } from '../../types/analytics'
import type { Annotation } from '../../types/workspace'

dayjs.extend(isBetween)
dayjs.extend(tz)
dayjs.extend(utc)

type GoalMetricKey = 'goals' | 'sum_goal_value' | 'median_goal_value'

interface GoalMetricData {
  current: number
  previous?: number
  change?: number
  chartData: ChartDataPoint[]
  chartDataPrev: ChartDataPoint[]
}

interface GoalCardProps {
  goalName: string
  metrics: {
    goals: GoalMetricData
    sum_goal_value: GoalMetricData
    median_goal_value: GoalMetricData
  }
  showComparison: boolean
  currency: string
  annotations?: Annotation[]
  granularity: Granularity
  timezone: string
  onViewDashboard: () => void
}

const PRIMARY_COLOR = '#7763f1'

const METRIC_CONFIG: {
  key: GoalMetricKey
  label: string
  format: 'number' | 'currency'
}[] = [
  { key: 'goals', label: 'Count', format: 'number' },
  { key: 'sum_goal_value', label: 'Value', format: 'currency' },
  { key: 'median_goal_value', label: 'Median', format: 'currency' },
]

function granularityToUnit(granularity: Granularity): dayjs.OpUnitType {
  switch (granularity) {
    case 'hour': return 'hour'
    case 'day':
    case 'week': return 'day'
    case 'month': return 'month'
    case 'year': return 'year'
    default: return 'day'
  }
}

function findDataPointLabelForAnnotation(
  annotationDate: string,
  annotationTime: string,
  currentData: ChartDataPoint[],
  granularity: Granularity,
  annotationTimezone: string,
  workspaceTimezone: string
): string {
  const annDateTime = dayjs.tz(`${annotationDate} ${annotationTime}`, annotationTimezone)
  const unit = granularityToUnit(granularity)

  for (const point of currentData) {
    const pointDate = dayjs.tz(point.timestamp, workspaceTimezone)
    if (pointDate.isSame(annDateTime, unit) || pointDate.isAfter(annDateTime, unit)) {
      return formatXAxisLabel(point.timestamp, granularity)
    }
  }

  return formatXAxisLabel(currentData[currentData.length - 1]?.timestamp || '', granularity)
}

function createMiniChartOption(
  currentData: ChartDataPoint[],
  previousData: ChartDataPoint[],
  showComparison: boolean,
  annotations: Annotation[],
  granularity: Granularity,
  workspaceTimezone: string
): EChartsOption {
  const xAxisData = currentData.map((d) => formatXAxisLabel(d.timestamp, granularity))
  const currentValues = currentData.map((d) => d.value)
  const previousValues = previousData.map((d) => d.value)

  // Filter annotations within chart data range
  const filteredAnnotations = annotations.filter((a) => {
    if (currentData.length < 2) return false
    const firstTimestamp = currentData[0]?.timestamp
    const lastTimestamp = currentData[currentData.length - 1]?.timestamp
    if (!firstTimestamp || !lastTimestamp) return false
    const annoTz = a.timezone || workspaceTimezone
    const annotationDate = dayjs.tz(a.date, annoTz)
    const dataStart = dayjs.tz(firstTimestamp, workspaceTimezone)
    const dataEnd = dayjs.tz(lastTimestamp, workspaceTimezone)
    if (!dataStart.isValid() || !dataEnd.isValid()) return false
    return annotationDate.isBetween(dataStart, dataEnd, 'day', '[]')
  })

  return {
    animation: false,
    grid: { left: 0, right: 0, top: filteredAnnotations.length > 0 ? 15 : 5, bottom: 5 },
    xAxis: {
      type: 'category',
      show: false,
      boundaryGap: false,
      data: xAxisData,
    },
    yAxis: { type: 'value', show: false },
    tooltip: {
      show: false,
      trigger: 'item',
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: PRIMARY_COLOR, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${PRIMARY_COLOR}40` },
              { offset: 1, color: `${PRIMARY_COLOR}05` },
            ],
          },
        },
        data: currentValues,
        markLine: filteredAnnotations.length > 0
          ? {
              silent: false,
              symbol: ['none', 'none'],
              tooltip: {
                show: true,
                trigger: 'item',
                formatter: ((params: { data: { annotation?: Annotation } }) => {
                  const ann = params.data?.annotation
                  if (!ann) return ''
                  const bulletColor = ann.color || PRIMARY_COLOR
                  return `
                    <div style="max-width: 280px;">
                      <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 4px;">
                        <span style="color: ${bulletColor}; font-size: 14px;">●</span>
                        ${ann.title}
                      </div>
                      <div style="color: #6b7280; font-size: 11px;">${ann.date} ${ann.time} (${ann.timezone})</div>
                      ${ann.description ? `<div style="margin-top: 8px; white-space: pre-wrap;">${ann.description}</div>` : ''}
                    </div>
                  `
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }) as any
              },
              data: filteredAnnotations.map((a) => {
                const annoTz = a.timezone || workspaceTimezone
                const bulletColor = a.color || PRIMARY_COLOR
                return {
                  xAxis: findDataPointLabelForAnnotation(a.date, a.time, currentData, granularity, annoTz, workspaceTimezone),
                  annotation: a,
                  lineStyle: {
                    color: bulletColor,
                    type: 'dotted' as const,
                    width: 2,
                  },
                  label: {
                    show: true,
                    formatter: `{bullet|●}`,
                    position: 'start',
                    distance: -12,
                    rich: {
                      bullet: {
                        color: bulletColor,
                        fontSize: 10,
                      },
                    },
                  },
                }
              }),
            }
          : undefined,
      },
      ...(showComparison && previousValues.length > 0
        ? [
            {
              type: 'line' as const,
              smooth: true,
              symbol: 'none' as const,
              lineStyle: { color: '#9ca3af', width: 1 },
              data: previousValues,
            },
          ]
        : []),
    ],
  }
}

export function GoalCard({
  goalName,
  metrics,
  showComparison,
  currency,
  annotations = [],
  granularity,
  timezone,
  onViewDashboard,
}: GoalCardProps) {
  const [selectedMetric, setSelectedMetric] = useState<GoalMetricKey>('goals')

  const selectedData = metrics[selectedMetric]

  return (
    <Card
      styles={{ body: { padding: 0 } }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-medium text-gray-800">{goalName}</span>
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          onClick={onViewDashboard}
          title="View full dashboard"
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3">
        {METRIC_CONFIG.map((config, index) => {
          const data = metrics[config.key]
          const isSelected = selectedMetric === config.key
          const isLast = index === METRIC_CONFIG.length - 1
          const changePercent = data.change ?? 0
          const isPositive = changePercent >= 0

          return (
            <div
              key={config.key}
              onClick={() => setSelectedMetric(config.key)}
              className={`
                cursor-pointer p-3 transition-colors text-center
                ${!isLast ? 'border-r border-gray-100' : ''}
                ${isSelected ? 'border-b-2 border-b-[var(--primary)] bg-gray-50/50' : 'border-b border-b-gray-100 hover:bg-gray-50'}
              `}
            >
              <div className="text-xs text-gray-500 mb-1">{config.label}</div>
              <div className="text-lg font-semibold text-gray-800">
                {config.format === 'currency'
                  ? (data.current === 0 ? '-' : formatCurrency(data.current, currency))
                  : formatNumber(data.current)}
              </div>
              {showComparison && changePercent !== 0 && (
                <Statistic
                  value={Math.abs(changePercent)}
                  precision={0}
                  valueStyle={{
                    fontSize: '11px',
                    color: isPositive ? '#10b981' : '#f97316',
                    fontWeight: 500,
                  }}
                  prefix={
                    changePercent >= 0 ? (
                      <ChevronUp size={10} style={{ marginRight: '1px' }} />
                    ) : (
                      <ChevronDown size={10} style={{ marginRight: '1px' }} />
                    )
                  }
                  suffix="%"
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Mini Chart */}
      <div className="px-2 pb-2">
        {selectedData.chartData.length > 0 ? (
          <ReactECharts
            option={createMiniChartOption(
              selectedData.chartData,
              selectedData.chartDataPrev,
              showComparison,
              annotations,
              granularity,
              timezone
            )}
            style={{ height: 80 }}
            opts={{ renderer: 'svg' }}
            notMerge
          />
        ) : (
          <div className="h-[80px] flex items-center justify-center text-gray-400 text-xs">
            No chart data
          </div>
        )}
      </div>
    </Card>
  )
}
