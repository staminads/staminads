import { createFileRoute, Outlet, Link, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Select, Button, Avatar, Spin, Space } from 'antd'
import { LogoutOutlined, PlusOutlined } from '@ant-design/icons'
import { workspacesQueryOptions, workspaceQueryOptions } from '../../../lib/queries'
import { useAuth } from '../../../lib/auth'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId')({
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
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId }}
                activeOptions={{ exact: true }}
                className="px-4 py-2 rounded !text-gray-500 hover:!text-[#7763f1] transition-colors [&.active]:!text-[#7763f1] [&.active]:bg-white"
              >
                Dashboard
              </Link>
              <Link
                to="/workspaces/$workspaceId/explore"
                params={{ workspaceId }}
                className="px-4 py-2 rounded !text-gray-500 hover:!text-[#7763f1] transition-colors [&.active]:!text-[#7763f1] [&.active]:bg-white"
              >
                Explore
              </Link>
              <Link
                to="/workspaces/$workspaceId/settings"
                params={{ workspaceId }}
                className="px-4 py-2 rounded !text-gray-500 hover:!text-[#7763f1] transition-colors [&.active]:!text-[#7763f1] [&.active]:bg-white"
              >
                Settings
              </Link>
            </nav>
          </Space>

          {/* Right: Logout Icon */}
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
