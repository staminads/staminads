import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Spin, Avatar, Button } from 'antd'
import { PlusOutlined, RightOutlined } from '@ant-design/icons'
import { workspacesQueryOptions } from '../../../lib/queries'
import { useAuth } from '../../../lib/useAuth'

export const Route = createFileRoute('/_authenticated/workspaces/')({
  component: WorkspacesPage,
})

function WorkspacesPage() {
  const { user } = useAuth()
  const { data: workspaces = [], isLoading } = useQuery(workspacesQueryOptions)

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: 'url(/background.jpg)',
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
        <img src="/logo.svg" alt="Staminads" className="h-8 mx-auto mb-6" />
        <h2 className="text-center text-gray-600 mb-6">Select a workspace</h2>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spin size="large" />
          </div>
        ) : (
          <div className="space-y-4">
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                className="block"
              >
                <div className="group flex items-center gap-3 p-3 rounded bg-white border border-transparent hover:border-[var(--primary)] transition-all">
                  <Avatar
                    src={workspace.logo_url}
                    size={40}
                    shape="square"
                    className="flex-shrink-0"
                  >
                    {workspace.name[0]?.toUpperCase()}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">{workspace.name}</div>
                    <div className="text-[11px] text-gray-500 truncate">{workspace.website}</div>
                  </div>
                  <RightOutlined className="flex-shrink-0 text-gray-400 group-hover:text-[var(--primary)]" />
                </div>
              </Link>
            ))}

            {workspaces.length === 0 && !user?.isSuperAdmin && (
              <div className="text-center text-gray-500 py-4">
                You don't have access to any workspace yet.
                <br />
                Ask an administrator to invite you.
              </div>
            )}

            {user?.isSuperAdmin && (
              <Link to="/workspaces/new" className="block mt-10">
                <Button
                  type="link"
                  size="small"
                  block
                  icon={<PlusOutlined />}
                >
                  Create workspace
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Photo credit */}
      <div className="absolute bottom-2 left-2 text-[10px] text-white/60">
        Photo by{' '}
        <a
          href="https://unsplash.com/fr/@rodlong?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
          className="underline hover:text-white/80"
          target="_blank"
          rel="noopener noreferrer"
        >
          Rod Long
        </a>
      </div>
    </div>
  )
}
