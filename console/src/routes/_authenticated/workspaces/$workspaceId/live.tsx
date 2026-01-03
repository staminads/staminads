import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { workspaceQueryOptions, liveAnalyticsQueryOptions } from '../../../../lib/queries'
import { useTimezone } from '../../../../hooks/useTimezone'
import { LiveMap } from '../../../../components/live/LiveMap'
import { LivePagesWidget } from '../../../../components/live/LivePagesWidget'
import { LiveCitiesWidget } from '../../../../components/live/LiveCitiesWidget'
import { LiveReferrersWidget } from '../../../../components/live/LiveReferrersWidget'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/live')({
  component: LiveView,
})

function LiveView() {
  const { workspaceId } = Route.useParams()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))
  const { timezone } = useTimezone(workspace.timezone)

  // Query for map data (sessions with coordinates)
  const mapQuery = useQuery(
    liveAnalyticsQueryOptions({
      workspace_id: workspaceId,
      metrics: ['sessions'],
      dimensions: ['latitude', 'longitude', 'city', 'country'],
      dateRange: { preset: 'last_30_minutes' },
      timezone,
      limit: 500,
    })
  )

  // Query for top pages
  const pagesQuery = useQuery(
    liveAnalyticsQueryOptions({
      workspace_id: workspaceId,
      metrics: ['sessions'],
      dimensions: ['landing_path'],
      dateRange: { preset: 'last_30_minutes' },
      order: { sessions: 'desc' },
      limit: 5,
      timezone,
    })
  )

  // Query for top cities
  const citiesQuery = useQuery(
    liveAnalyticsQueryOptions({
      workspace_id: workspaceId,
      metrics: ['sessions'],
      dimensions: ['city', 'country'],
      dateRange: { preset: 'last_30_minutes' },
      order: { sessions: 'desc' },
      limit: 5,
      timezone,
    })
  )

  // Query for top referrers
  const referrersQuery = useQuery(
    liveAnalyticsQueryOptions({
      workspace_id: workspaceId,
      metrics: ['sessions'],
      dimensions: ['referrer_domain'],
      dateRange: { preset: 'last_30_minutes' },
      order: { sessions: 'desc' },
      limit: 5,
      timezone,
    })
  )

  // Transform data for components
  const mapData = Array.isArray(mapQuery.data?.data)
    ? mapQuery.data.data.map((row) => ({
        latitude: row.latitude as number | null,
        longitude: row.longitude as number | null,
        city: row.city as string | null,
        country: row.country as string | null,
        sessions: row.sessions as number,
      }))
    : []

  const pagesData = Array.isArray(pagesQuery.data?.data)
    ? pagesQuery.data.data.map((row) => ({
        landing_path: row.landing_path as string,
        sessions: row.sessions as number,
      }))
    : []

  const citiesData = Array.isArray(citiesQuery.data?.data)
    ? citiesQuery.data.data.map((row) => ({
        city: row.city as string,
        country: row.country as string,
        sessions: row.sessions as number,
      }))
    : []

  const referrersData = Array.isArray(referrersQuery.data?.data)
    ? referrersQuery.data.data.map((row) => ({
        referrer_domain: row.referrer_domain as string,
        sessions: row.sessions as number,
      }))
    : []

  // Calculate total live sessions
  const totalSessions = mapData.reduce((sum, d) => sum + d.sessions, 0)

  return (
    <div className="flex-1 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId }}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft size={16} />
            <span className="text-sm">Dashboard</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="text-lg font-medium text-gray-800">
            {totalSessions} live now
          </span>
        </div>
      </div>

      {/* Map */}
      <LiveMap data={mapData} loading={mapQuery.isLoading} />

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <LivePagesWidget
          data={pagesData}
          loading={pagesQuery.isLoading}
          workspaceId={workspace.website?.replace(/^https?:\/\//, '') || workspaceId}
        />
        <LiveCitiesWidget data={citiesData} loading={citiesQuery.isLoading} />
        <LiveReferrersWidget data={referrersData} loading={referrersQuery.isLoading} />
      </div>
    </div>
  )
}
