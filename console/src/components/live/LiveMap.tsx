import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { Spin } from 'antd'
import worldGeoJson from '../../lib/world-geo.json'

// Register map once on module load (same as CountriesMapWidget)
echarts.registerMap('world', worldGeoJson as Parameters<typeof echarts.registerMap>[1])

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
        roam: false,
        left: 10,
        right: 10,
        top: 10,
        bottom: 10,
        itemStyle: {
          areaColor: '#eeebfc',
          borderColor: '#d4cdf7',
          borderWidth: 0.5,
        },
        emphasis: {
          itemStyle: {
            areaColor: '#d4cdf7',
          },
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
      <div className="flex items-center justify-center h-[400px]">
        <Spin />
      </div>
    )
  }

  // Always render the map, even with no sessions (scatterData can be empty)
  return (
    <div className="overflow-hidden">
      <ReactECharts
        option={option}
        style={{ height: 400, width: '100%' }}
        opts={{ renderer: 'svg' }}
      />
    </div>
  )
}
