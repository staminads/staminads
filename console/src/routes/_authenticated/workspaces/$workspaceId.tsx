import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Select, Button, Avatar, Spin, Space } from 'antd'
import { LogoutOutlined, PlusOutlined } from '@ant-design/icons'
import { workspacesQueryOptions, workspaceQueryOptions } from '../../../lib/queries'
import { useAuth } from '../../../lib/auth'
import type { DatePreset } from '../../../types/analytics'
import type { WorkspaceSearch, ComparisonMode } from '../../../types/dashboard'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId')({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    period: (search.period as DatePreset) || undefined,
    timezone: (search.timezone as string) || undefined,
    comparison: (search.comparison as ComparisonMode) || undefined,
    customStart: (search.customStart as string) || undefined,
    customEnd: (search.customEnd as string) || undefined,
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(workspacesQueryOptions),
      context.queryClient.ensureQueryData(workspaceQueryOptions(params.workspaceId)),
    ])
  },
  component: WorkspaceLayout,
  pendingComponent: () => (
    <div className="flex-1 flex items-center justify-center">
      <Spin size="large" />
    </div>
  ),
})

function WorkspaceLayout() {
  const { workspaceId } = Route.useParams()
  const { data: workspaces } = useSuspenseQuery(workspacesQueryOptions)
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))
  const { logout } = useAuth()
  const navigate = useNavigate()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  const handleLogout = () => {
    logout()
    navigate({ to: '/login' })
  }

  const handleWorkspaceChange = (id: string) => {
    if (id === 'new') {
      navigate({ to: '/workspaces/new' })
    } else {
      navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: id } })
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)]">
      <header className="bg-[var(--background)]">
        <div className="h-16 max-w-7xl mx-auto px-6 flex items-center justify-between border-b border-gray-200">
          {/* Left: Logo + Workspace Selector + Navigation */}
          <Space size="large">
            <img src="/logo.svg" alt="Staminads" className="h-6" />
            <Select
              value={workspaceId}
              onChange={handleWorkspaceChange}
              variant="filled"
              className="min-w-40"
              popupMatchSelectWidth={false}
              labelRender={() => (
                <div className="flex items-center gap-2">
                  <Avatar src={workspace.logo_url} shape="square" size={20}>
                    {workspace.name[0]}
                  </Avatar>
                  <span className="text-gray-800">{workspace.name}</span>
                </div>
              )}
              options={[
                ...workspaces.map((ws) => ({
                  value: ws.id,
                  label: (
                    <div className="flex items-center gap-2">
                      <Avatar src={ws.logo_url} shape="square" size={20}>
                        {ws.name[0]}
                      </Avatar>
                      <span>{ws.name}</span>
                    </div>
                  ),
                })),
                {
                  value: 'new',
                  label: (
                    <div className="flex items-center gap-2 text-[var(--primary)]">
                      <PlusOutlined />
                      <span>New workspace</span>
                    </div>
                  ),
                },
              ]}
            />
            <nav className="flex gap-1">
              {[
                { to: '/workspaces/$workspaceId', label: 'Dashboard', exact: true },
                { to: '/workspaces/$workspaceId/explore', label: 'Explore' },
                { to: '/workspaces/$workspaceId/filters', label: 'Filters' },
                { to: '/workspaces/$workspaceId/settings', label: 'Settings' },
              ].map(({ to, label, exact }) => {
                const resolvedPath = to.replace('$workspaceId', workspaceId)
                const isActive = exact
                  ? currentPath === resolvedPath
                  : currentPath.startsWith(resolvedPath)
                return (
                  <Link
                    key={to}
                    to={to}
                    params={{ workspaceId }}
                    className={`px-4 py-2 rounded transition-colors ${
                      isActive
                        ? '!text-[var(--primary)] bg-white'
                        : '!text-gray-500 hover:!text-[var(--primary)]'
                    }`}
                  >
                    {label}
                  </Link>
                )
              })}
            </nav>
          </Space>

          {/* Right: Logout */}
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            className="!text-gray-500 hover:!text-gray-800 hover:!bg-gray-100"
          />
        </div>
      </header>

      <div className="flex-1">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
