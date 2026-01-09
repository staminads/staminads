import { useMemo } from 'react'
import { Alert, Button } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { analyticsQueryOptions } from '../../lib/queries'
import type { AnalyticsQuery, AnalyticsResponse } from '../../types/analytics'

interface SdkVersionWarningProps {
  workspaceId: string
  timezone: string
}

export function SdkVersionWarning({ workspaceId, timezone }: SdkVersionWarningProps) {
  // Memoize query to prevent endless re-fetching
  const query = useMemo<AnalyticsQuery>(() => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    return {
      workspace_id: workspaceId,
      metrics: ['sessions'],
      dimensions: ['sdk_version'],
      dateRange: {
        start: yesterday.toISOString(),
        end: now.toISOString()
      },
      timezone,
      limit: 10
    }
  }, [workspaceId, timezone])

  const { data, isLoading } = useQuery(analyticsQueryOptions(query))

  if (isLoading || !data) return null

  // Extract sdk_version values from response
  const responseData = data as AnalyticsResponse
  const versions = (responseData.data as Record<string, unknown>[])
    .map((row) => row.sdk_version as string)
    .filter((v) => v && v !== '')

  // If no versions found, no sessions have been tracked
  if (versions.length === 0) return null

  // Check if current app version exists in the results
  const currentVersion = __APP_VERSION__
  const hasCurrentVersion = versions.includes(currentVersion)

  // If current version is found, no warning needed
  if (hasCurrentVersion) return null

  return (
    <Alert
      type="warning"
      className="mb-6!"
      message={
        <div className="flex items-center justify-between">
          <span>
            Outdated SDK detected ({versions[0]} → {currentVersion})
          </span>
          <Link to="/workspaces/$workspaceId/settings" params={{ workspaceId }} search={{ section: 'sdk' }}>
            <Button type="link" size="small" className="p-0">
              Update SDK
            </Button>
          </Link>
        </div>
      }
    />
  )
}
