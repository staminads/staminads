import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { Spin, Empty } from 'antd'
import worldGeoJson from '../../lib/world-geo.json'
import { ISO2_TO_ISO3, ISO3_TO_ISO2, getCountryName } from '../../lib/iso-countries'
import { formatValue } from '../../lib/chart-utils'
import type { DimensionData } from '../../types/dashboard'

// Register map once on module load
echarts.registerMap('world', worldGeoJson as Parameters<typeof echarts.registerMap>[1])

// Build ISO3 code to GeoJSON name mapping for ECharts nameMap
const iso3ToGeoName: Record<string, string> = {}
const geoNameToIso3: Record<string, string> = {}
;(worldGeoJson as { features: Array<{ id: string; properties: { name: string } }> }).features.forEach((f) => {
  if (f.id && f.properties?.name) {
    iso3ToGeoName[f.id] = f.properties.name
    geoNameToIso3[f.properties.name] = f.id
  }
})

interface CountryMapViewProps {
  data: DimensionData[]
  loading: boolean
  onCountryClick?: (countryCode: string) => void
}

export function CountryMapView({ data, loading, onCountryClick }: CountryMapViewProps) {
  // Find max sessions for color scaling
  const maxSessions = useMemo(() => {
    if (data.length === 0) return 1
    return Math.max(...data.map((d) => d.sessions))
  }, [data])

  // Transform data for ECharts - convert ISO2 to GeoJSON country name for matching
  const mapData = useMemo(() => {
    return data
      .map((d) => {
        const iso2 = d.dimension_value.toUpperCase()
        const iso3 = ISO2_TO_ISO3[iso2] || iso2
        const geoName = iso3ToGeoName[iso3]
        if (!geoName) return null // Skip if country not in GeoJSON

        return {
          name: geoName,
          value: d.sessions,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [data])

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (params: { name?: string; value?: number; data?: { value?: number } }) => {
          const displayName = params.name ? getCountryName(params.name) : ''
          const value = params.data?.value
          if (value === undefined || value === null || Number.isNaN(value)) {
            return displayName
          }
          return `${displayName}: ${formatValue(value, 'number')} sessions`
        },
      },
      geo: {
        map: 'world',
        roam: false,
        left: 10,
        right: 10,
        top: 10,
        bottom: 10,
        itemStyle: {
          areaColor: '#f9fafb',
          borderColor: '#e5e7eb',
          borderWidth: 0.5,
        },
        emphasis: {
          itemStyle: {
            areaColor: '#7763f1',
          },
          label: {
            show: true,
            fontSize: 10,
          },
        },
      },
      visualMap: {
        min: 0,
        max: maxSessions,
        show: false,
        inRange: {
          color: [
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
          name: 'country',
          type: 'map',
          geoIndex: 0,
          data: mapData,
        },
      ],
    }),
    [mapData, maxSessions]
  )

  // Handle click events on the map
  const onEvents = useMemo(() => {
    if (!onCountryClick) return undefined
    return {
      click: (params: { name?: string }) => {
        if (params.name) {
          // Convert GeoJSON name back to ISO2 code
          const iso3 = geoNameToIso3[params.name]
          const iso2 = iso3 ? ISO3_TO_ISO2[iso3] : null
          if (iso2) {
            onCountryClick(iso2.toLowerCase())
          }
        }
      },
    }
  }, [onCountryClick])

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[290px]">
        <Spin />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <Empty
        description="No country data"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        className="py-8"
      />
    )
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: 290, width: '100%' }}
      opts={{ renderer: 'svg' }}
      onEvents={onEvents}
    />
  )
}
