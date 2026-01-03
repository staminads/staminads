import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { liveAnalyticsQueryOptions } from '../../lib/queries'
import { useTimezone } from '../../hooks/useTimezone'

interface LiveButtonProps {
  workspaceId: string
  workspaceTimezone: string
}

export function LiveButton({ workspaceId, workspaceTimezone }: LiveButtonProps) {
  const { timezone } = useTimezone(workspaceTimezone)

  const { data } = useQuery(
    liveAnalyticsQueryOptions({
      workspace_id: workspaceId,
      metrics: ['sessions'],
      dateRange: { preset: 'last_30_minutes' },
      timezone,
    })
  )

  const count = Array.isArray(data?.data)
    ? (data.data[0]?.sessions as number) ?? 0
    : 0

  return (
    <Link
      to="/workspaces/$workspaceId/live"
      params={{ workspaceId }}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
      </span>
      <span className="text-sm font-medium text-gray-700">Live</span>
      <span className="text-sm font-medium text-gray-700">
        {count > 0 ? count : '–'}
      </span>
    </Link>
  )
}
