import { createFileRoute, redirect } from '@tanstack/react-router'
import { Spin } from 'antd'
import { workspacesQueryOptions } from '../../lib/queries'
import type { Workspace } from '../../types/workspace'

export const Route = createFileRoute('/_authenticated/')({
  loader: async ({ context }) => {
    let workspaces: Workspace[] = []
    try {
      workspaces = await context.queryClient.ensureQueryData(workspacesQueryOptions)
    } catch {
      // On API error, redirect to create new workspace
      throw redirect({ to: '/workspaces/new' })
    }
    if (workspaces.length === 0) {
      throw redirect({ to: '/workspaces/new' })
    }
    // Redirect to first workspace
    throw redirect({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: workspaces[0].id },
    })
  },
  component: () => null,
  pendingComponent: () => (
    <div className="flex-1 flex items-center justify-center">
      <Spin size="large" />
    </div>
  ),
})
