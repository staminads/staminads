import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { Spin, Empty } from 'antd'
import { api } from '../../lib/api'
import type { EChartsOption } from 'echarts'

interface TimeScoreDistributionProps {
  workspaceId: string
  timescoreReference: number
}

export function TimeScoreDistribution({
  workspaceId,
  timescoreReference,
}: TimeScoreDistributionProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['timescore-distribution', workspaceId],
    queryFn: () =>
      api.analytics.query({
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dimensions: ['duration'],
        dateRange: { preset: 'previous_30_days' },
        order: { duration: 'asc' },
        limit: 300, // Cap at 5 minutes
      }),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spin size="small" />
      </div>
    )
  }

  const rows = Array.isArray(data?.data) ? data.data : []
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <Empty description="No session data" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  // Build per-second data (fill gaps with 0)
  const maxDuration = Math.min(
    Math.max(...rows.map((r) => Number(r.duration) || 0)),
    300
  )
  const sessionsByDuration = new Map<number, number>()
  for (const row of rows) {
    const dur = Number(row.duration) || 0
    if (dur <= 300) {
      sessionsByDuration.set(dur, Number(row.sessions) || 0)
    }
  }

  const xData: number[] = []
  const yData: number[] = []
  const colors: string[] = []

  for (let i = 0; i <= maxDuration; i++) {
    xData.push(i)
    yData.push(sessionsByDuration.get(i) || 0)
    // Green for >= reference, gray for below
    colors.push(i >= timescoreReference ? '#22c55e' : '#d1d5db')
  }

  const option: EChartsOption = {
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e5e7eb',
      borderWidth: 1,
      textStyle: { color: '#374151', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = params as { dataIndex: number; value: number }[]
        if (!Array.isArray(p) || p.length === 0) return ''
        const duration = p[0].dataIndex
        const sessions = p[0].value
        return `<b>${duration}s</b>: ${sessions.toLocaleString()} sessions`
      },
    },
    grid: {
      left: 40,
      right: 10,
      top: 10,
      bottom: 30,
    },
    xAxis: {
      type: 'category',
      data: xData,
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: {
        color: '#6b7280',
        fontSize: 10,
        interval: (index: number) => index % 30 === 0,
        formatter: (value: string) => `${value}s`,
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
      axisLabel: { color: '#6b7280', fontSize: 10 },
    },
    series: [
      {
        type: 'bar',
        data: yData.map((value, index) => ({
          value,
          itemStyle: { color: colors[index] },
        })),
        barWidth: '90%',
      },
    ],
    markLine: {
      silent: true,
      symbol: 'none',
      data: [
        {
          xAxis: timescoreReference,
          lineStyle: { color: '#22c55e', type: 'dashed', width: 2 },
          label: {
            formatter: `${timescoreReference}s`,
            position: 'end',
            color: '#22c55e',
            fontSize: 11,
          },
        },
      ],
    },
  }

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">
        Session duration distribution (last 30 days)
      </div>
      <ReactECharts option={option} style={{ height: 120 }} opts={{ renderer: 'svg' }} />
      <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gray-300" /> Below reference
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-green-500" /> At or above reference
        </span>
      </div>
    </div>
  )
}
