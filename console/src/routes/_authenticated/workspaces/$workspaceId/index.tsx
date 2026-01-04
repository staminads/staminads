import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { DashboardGrid } from '../../../../components/dashboard/DashboardGrid'
import { DashboardFilters } from '../../../../components/dashboard/DashboardFilters'
import { LiveButton } from '../../../../components/live/LiveButton'
import { useDashboardParams } from '../../../../hooks/useDashboardParams'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/')({
  component: Dashboard,
})

function Dashboard() {
  const { workspaceId } = Route.useParams()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))
  const {
    period,
    timezone,
    comparison,
    customStart,
    customEnd,
    setPeriod,
    setComparison,
    setCustomRange,
    isPending,
  } = useDashboardParams(workspace.timezone)

  return (
    <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-light text-gray-800">Dashboard</h1>
          <LiveButton workspaceId={workspaceId} workspaceTimezone={workspace.timezone} />
        </div>
        <DashboardFilters
          period={period}
          timezone={timezone}
          workspaceCreatedAt={workspace.created_at}
          comparison={comparison}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={setPeriod}
          onComparisonChange={setComparison}
          onCustomRangeChange={setCustomRange}
          isPending={isPending}
        />
      </div>
      <DashboardGrid
        workspaceId={workspaceId}
        workspaceTimezone={workspace.timezone}
        timescoreReference={workspace.settings.timescore_reference ?? 60}
        comparison={comparison}
        customStart={customStart}
        customEnd={customEnd}
        annotations={workspace.settings.annotations}
      />
    </div>
  )
}
