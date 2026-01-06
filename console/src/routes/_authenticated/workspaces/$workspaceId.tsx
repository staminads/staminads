import { useState, useRef, useEffect } from 'react'
import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Select, Button, Avatar, Spin, Space, Popover, Tooltip, App, Dropdown } from 'antd'
import type { RefSelectProps } from 'antd/es/select'
import { LogoutOutlined, PlusOutlined, GlobalOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { workspacesQueryOptions, workspaceQueryOptions, backfillSummaryQueryOptions } from '../../../lib/queries'
import { SyncStatusIcon } from '../../../components/layout/SyncStatusIcon'
import { useAuth } from '../../../lib/useAuth'
import { useTimezone } from '../../../hooks/useTimezone'
import type { DatePreset } from '../../../types/analytics'
import type { WorkspaceSearch, ComparisonMode } from '../../../types/dashboard'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId')({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    // Shared params (dashboard + explore)
    period: (search.period as DatePreset) || undefined,
    timezone: (search.timezone as string) || undefined,
    comparison: (search.comparison as ComparisonMode) || undefined,
    customStart: (search.customStart as string) || undefined,
    customEnd: (search.customEnd as string) || undefined,
    // Explore-specific params
    dimensions: (search.dimensions as string) || undefined,
    filters: (search.filters as string) || undefined,
    minSessions: (search.minSessions as string) || undefined,
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(workspacesQueryOptions),
      context.queryClient.ensureQueryData(workspaceQueryOptions(params.workspaceId)),
      context.queryClient.ensureQueryData(backfillSummaryQueryOptions(params.workspaceId)),
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
  const { logout, user } = useAuth()
  const { message } = App.useApp()
  const { timezone, setTimezone, workspaceTimezone } = useTimezone(workspace.timezone)
  const navigate = useNavigate()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const [timezonePopoverOpen, setTimezonePopoverOpen] = useState(false)
  const timezoneSelectRef = useRef<RefSelectProps>(null)

  // Focus the Select search input when popover opens
  useEffect(() => {
    if (timezonePopoverOpen && timezoneSelectRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        timezoneSelectRef.current?.focus()
      }, 0)
    }
  }, [timezonePopoverOpen])

  // Redirect to install-sdk if workspace is not active
  const isInstallSdkPage = currentPath.endsWith('/install-sdk')
  useEffect(() => {
    if (workspace.status !== 'active' && !isInstallSdkPage) {
      navigate({
        to: '/workspaces/$workspaceId/install-sdk',
        params: { workspaceId },
        replace: true,
      })
    }
  }, [workspace.status, isInstallSdkPage, navigate, workspaceId])

  const isWorkspaceActive = workspace.status === 'active'

  // Build timezone options with workspace timezone first, then all IANA timezones
  const allTimezones = Intl.supportedValuesOf('timeZone')
  const timezoneOptions = [
    { value: workspaceTimezone, label: workspaceTimezone },
    ...allTimezones.filter((tz) => tz !== workspaceTimezone).map((tz) => ({
      value: tz,
      label: tz,
    })),
  ]

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
                // Only show "New workspace" option for super admins
                ...(user?.isSuperAdmin ? [{
                  value: 'new',
                  label: (
                    <div className="flex items-center gap-2 text-[var(--primary)]">
                      <PlusOutlined />
                      <span>New workspace</span>
                    </div>
                  ),
                }] : []),
              ]}
            />
            {isWorkspaceActive && (
              <div className="flex items-center">
                <div className="h-5 w-px bg-gray-200" />
                <nav className="flex gap-1 pl-2">
                {[
                  { to: '/workspaces/$workspaceId', label: 'Dashboard', exact: true },
                  { to: '/workspaces/$workspaceId/explore', label: 'Explore' },
                  { to: '/workspaces/$workspaceId/filters', label: 'Filters' },
                  { to: '/workspaces/$workspaceId/annotations', label: 'Annotations' },
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
              </div>
            )}
          </Space>

          {/* Right: Sync Status + Timezone + Logout */}
          <Space>
            {isWorkspaceActive && (
              <>
                <SyncStatusIcon workspaceId={workspaceId} />
                <Tooltip title={`Timezone: ${timezone}`} placement="left">
                  <Popover
                    open={timezonePopoverOpen}
                    onOpenChange={setTimezonePopoverOpen}
                    trigger="click"
                    placement="bottom"
                    destroyOnHidden
                    content={
                      <Select
                        ref={timezoneSelectRef}
                        value={timezone}
                        onChange={(value) => {
                          setTimezone(value)
                          setTimezonePopoverOpen(false)
                          message.success(`Timezone set to ${value}`)
                        }}
                        variant="filled"
                        className="w-48"
                        showSearch
                        popupMatchSelectWidth={false}
                        optionFilterProp="label"
                        options={timezoneOptions}
                        open={timezonePopoverOpen}
                        onOpenChange={(open) => {
                          if (!open) setTimezonePopoverOpen(false)
                        }}
                        getPopupContainer={(trigger) => trigger.parentElement!}
                      />
                    }
                  >
                    <Button
                      type="text"
                      icon={<GlobalOutlined />}
                      className="!text-gray-500 hover:!text-gray-800 hover:!bg-gray-100"
                    />
                  </Popover>
                </Tooltip>
              </>
            )}
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'documentation',
                    label: (
                      <a href="https://docs.staminads.com" target="_blank" rel="noopener noreferrer">
                        Documentation
                      </a>
                    ),
                  },
                  {
                    key: 'report-issue',
                    label: (
                      <a href="https://github.com/staminads/staminads/issues" target="_blank" rel="noopener noreferrer">
                        Report an issue
                      </a>
                    ),
                  },
                  { type: 'divider' },
                  {
                    key: 'version',
                    label: `v${__APP_VERSION__}`,
                    disabled: true,
                  },
                ],
              }}
              placement="bottomRight"
            >
              <Button
                type="text"
                icon={<QuestionCircleOutlined />}
                className="!text-gray-500 hover:!text-gray-800 hover:!bg-gray-100"
              />
            </Dropdown>
            <Tooltip title="Logout" placement="left">
              <Button
                type="text"
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                className="!text-gray-500 hover:!text-gray-800 hover:!bg-gray-100"
              />
            </Tooltip>
          </Space>
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
