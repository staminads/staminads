import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/explore')({
  component: Explore,
})

function Explore() {
  return (
    <div className="flex-1 p-6">
      <h1 className="text-2xl font-light text-gray-800 mb-4">Explore</h1>
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <p className="text-gray-600">Explore content coming soon...</p>
      </div>
    </div>
  )
}
