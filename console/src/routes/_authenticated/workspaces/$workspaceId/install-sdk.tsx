import { useState, useEffect, useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQueryClient, useQuery } from '@tanstack/react-query'
import { Button, Spin, Alert } from 'antd'
import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { api } from '../../../../lib/api'
import { CodeSnippet } from '../../../../components/setup/CodeSnippet'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/install-sdk')({
  component: InstallSDK
})

function InstallSDK() {
  const { workspaceId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  // Fetch SDK version for cache busting
  const { data: sdkVersion } = useQuery({
    queryKey: ['sdk-version'],
    queryFn: async () => {
      const res = await fetch('/sdk/version.json')
      const data = await res.json()
      return data.version as string
    },
    staleTime: Infinity
  })

  const [eventDetected, setEventDetected] = useState(workspace.status === 'active')

  const checkEvents = useCallback(async () => {
    if (eventDetected) return

    try {
      const result = await api.analytics.query({
        workspace_id: workspaceId,
        metrics: ['events'],
        dateRange: { preset: 'all_time' }
      })

      // Check data array for event count
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        const events = (result.data[0] as Record<string, unknown>)?.events ?? 0
        if (typeof events === 'number' && events > 0) {
          await api.workspaces.update({ id: workspaceId, status: 'active' })
          setEventDetected(true)
          queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] })
          queryClient.invalidateQueries({ queryKey: ['workspaces'] })
        }
      }
    } catch {
      // Silently ignore errors during polling
    }
  }, [workspaceId, eventDetected, queryClient])

  // Poll for events every 3 seconds
  useEffect(() => {
    if (eventDetected) return

    const interval = setInterval(checkEvents, 3000)
    checkEvents() // initial check

    return () => clearInterval(interval)
  }, [eventDetected, checkEvents])

  const handleSkip = () => {
    navigate({ to: '/workspaces/$workspaceId', params: { workspaceId } })
  }

  const handleContinue = () => {
    navigate({ to: '/workspaces/$workspaceId', params: { workspaceId } })
  }

  // Generate the SDK snippet with workspace_id pre-filled and version for cache busting
  const versionParam = sdkVersion ? `?v=${sdkVersion}` : ''
  const sdkSnippet = `<!-- Staminads -->
<script src="${window.location.origin}/sdk/staminads.min.js${versionParam}"></script>
<script>
  Staminads.init({
    workspace_id: '${workspaceId}',
    endpoint: '${window.location.origin}'
  });
</script>`

  return (
    <div className="flex-1 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-light text-gray-800 mb-2">Install the SDK</h1>
        <p className="text-gray-500 mb-8">
          Add this code snippet to your website's{' '}
          <code className="bg-gray-100 px-1 rounded">&lt;head&gt;</code> tag.
        </p>

        <CodeSnippet code={sdkSnippet} />

        <div className="mt-8">
          {eventDetected ? (
            <Alert
              type="success"
              icon={<CheckCircleFilled />}
              message="Event detected!"
              description="Your SDK is working correctly. You can now continue to your dashboard."
              showIcon
            />
          ) : (
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200 animate-pulse">
              <Spin indicator={<LoadingOutlined style={{ fontSize: 20 }} spin />} />
              <div>
                <div className="font-medium text-blue-900">Waiting for first event...</div>
                <div className="text-sm text-blue-700">
                  Install the SDK on your website and we'll detect it automatically.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex gap-3">
          {eventDetected ? (
            <Button type="primary" size="large" onClick={handleContinue}>
              Continue to Dashboard
            </Button>
          ) : (
            <Button type="default" size="large" onClick={handleSkip}>
              Skip for now
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
