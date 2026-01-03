import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { Spin, Empty } from 'antd'
import worldMap from '../../lib/world-map'

// Register map once on module load
echarts.registerMap('world', worldMap as unknown as Parameters<typeof echarts.registerMap>[1])

interface SessionLocation {
  latitude: number | null
  longitude: number | null
  city: string | null
  country: string | null
  sessions: number
}

interface LiveMapProps {
  data: SessionLocation[]
  loading: boolean
}

export function LiveMap({ data, loading }: LiveMapProps) {
  // Filter out sessions with null coordinates and transform for ECharts
  const scatterData = useMemo(() => {
    return data
      .filter((d) => d.latitude !== null && d.longitude !== null)
      .map((d) => ({
        name: d.city ? `${d.city}, ${d.country}` : d.country || 'Unknown',
        value: [d.longitude!, d.latitude!, d.sessions],
      }))
  }, [data])

  const option = useMemo(
    () => ({
      geo: {
        map: 'world',
        roam: true,
        silent: true,
        itemStyle: {
          areaColor: '#f9fafb',
          borderColor: '#e5e7eb',
          borderWidth: 0.5,
        },
        emphasis: {
          disabled: true,
        },
      },
      tooltip: {
        trigger: 'item',
        formatter: (params: { name?: string; value?: [number, number, number] }) => {
          if (!params.value) return ''
          const sessions = params.value[2]
          return `${params.name}: ${sessions} session${sessions !== 1 ? 's' : ''}`
        },
      },
      series: [
        {
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: scatterData,
          symbolSize: (val: [number, number, number]) => {
            // Scale dot size based on session count, min 6, max 20
            return Math.min(20, Math.max(6, 4 + val[2] * 2))
          },
          showEffectOn: 'render',
          rippleEffect: {
            brushType: 'stroke',
            scale: 3,
            period: 3,
          },
          itemStyle: {
            color: '#7763f1',
            shadowBlur: 10,
            shadowColor: '#7763f1',
          },
          zlevel: 1,
        },
      ],
    }),
    [scatterData]
  )

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] bg-white rounded-md">
        <Spin />
      </div>
    )
  }

  if (data.length === 0 || scatterData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] bg-white rounded-md">
        <Empty
          description="No live sessions in the last 30 minutes"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-md overflow-hidden">
      <ReactECharts
        option={option}
        style={{ height: 400, width: '100%' }}
        opts={{ renderer: 'svg' }}
      />
    </div>
  )
}
