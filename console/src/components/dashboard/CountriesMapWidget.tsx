import { useState, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { Spin, Empty } from 'antd'
import worldGeoJson from '../../lib/world-geo.json'
import { ISO2_TO_ISO3, getCountryName } from '../../lib/iso-countries'
import { formatValue } from '../../lib/chart-utils'
import type { CountryData } from './TabbedCountriesWidget'

// Register map once on module load
echarts.registerMap('world', worldGeoJson as Parameters<typeof echarts.registerMap>[1])

// Build ISO3 code to GeoJSON name mapping for ECharts nameMap
const iso3ToGeoName: Record<string, string> = {}
;(worldGeoJson as { features: Array<{ id: string; properties: { name: string } }> }).features.forEach((f) => {
  if (f.id && f.properties?.name) {
    iso3ToGeoName[f.id] = f.properties.name
  }
})

type TabKey = 'sessions' | 'median_duration'

interface Tab {
  key: TabKey
  label: string
}

const TABS: Tab[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'median_duration', label: 'TimeScore' },
]

interface CountriesMapWidgetProps {
  title: string
  data: CountryData[]
  loading: boolean
  timescoreReference?: number
  emptyText?: string
}

// Get heat map color based on value relative to reference (same logic as Explore page)
function getTimescoreColor(value: number, maxValue: number, reference: number): string {
  if (!maxValue || value <= 0) return 'rgba(249, 250, 251, 1)' // gray-50

  const effectiveMax = Math.max(maxValue, reference)

  if (value <= reference) {
    // Below/at reference: light → green
    const ratio = value / reference
    const lightness = 95 - (ratio * 30) // 95% → 65%
    return `hsl(142, 50%, ${lightness}%)`
  } else {
    // Above reference: green → cyan
    const headroom = effectiveMax - reference
    if (headroom <= 0) {
      return `hsl(180, 50%, 55%)`
    }
    const aboveRatio = Math.min((value - reference) / headroom, 1)
    const hue = 142 + (aboveRatio * 38) // 142 → 180 (cyan)
    const lightness = 65 - (aboveRatio * 10) // 65% → 55%
    return `hsl(${hue}, 50%, ${lightness}%)`
  }
}

export function CountriesMapWidget({
  title,
  data,
  loading,
  timescoreReference = 60,
  emptyText = 'No data available',
}: CountriesMapWidgetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('sessions')

  // Find max value for the active tab
  const maxValue = useMemo(() => {
    if (data.length === 0) return 1
    return Math.max(...data.map((d) => d[activeTab]))
  }, [data, activeTab])

  // Transform data for ECharts - convert ISO2 to GeoJSON country name for matching
  // For TimeScore, compute color based on reference value
  const mapData = useMemo(() => {
    return data
      .map((d) => {
        const value = d[activeTab]
        const iso2 = d.dimension_value.toUpperCase()
        const iso3 = ISO2_TO_ISO3[iso2] || iso2
        const geoName = iso3ToGeoName[iso3]
        if (!geoName) return null // Skip if country not in GeoJSON

        const item: { name: string; value: number; itemStyle?: { areaColor: string } } = {
          name: geoName,
          value,
        }
        // For TimeScore, use reference-based coloring
        if (activeTab === 'median_duration') {
          item.itemStyle = {
            areaColor: getTimescoreColor(value, maxValue, timescoreReference),
          }
        }
        return item
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [data, activeTab, maxValue, timescoreReference])

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (params: { name?: string; value?: number; data?: { value?: number } }) => {
          // params.name is the ISO3 code from GeoJSON
          const displayName = params.name ? getCountryName(params.name) : ''
          const value = params.data?.value
          if (value === undefined || value === null || Number.isNaN(value)) {
            return displayName
          }
          const format = activeTab === 'sessions' ? 'number' : 'duration'
          return `${displayName}: ${formatValue(value, format as 'number' | 'duration')}`
        },
      },
      geo: {
        map: 'world',
        roam: false,
        left: 10,
        right: 10,
        top: 30,
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
      visualMap: activeTab === 'sessions'
        ? {
            min: 0,
            max: maxValue,
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
          }
        : {
            // For TimeScore, colors are set per-item via itemStyle
            show: false,
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
    [mapData, maxValue, activeTab]
  )

  return (
    <div className="rounded-md overflow-hidden bg-white">
      {/* Title */}
      <div className="px-4 pt-4 pb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 px-4 border-b border-gray-200">
        {TABS.map((tab) => (
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

      {/* Map */}
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
        <div>
          <ReactECharts
            option={option}
            style={{ height: 300, width: '100%' }}
            opts={{ renderer: 'svg' }}
          />
        </div>
      )}
    </div>
  )
}
