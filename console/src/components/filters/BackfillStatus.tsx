import { useState } from 'react'
import { Alert, Button, Progress, Space, InputNumber, Popconfirm, Typography, App } from 'antd'
import { PlayCircleOutlined, StopOutlined, SyncOutlined } from '@ant-design/icons'
import { useBackfillStatus } from '../../hooks/useBackfillStatus'
import type { BackfillTaskProgress } from '../../types/filters'

const { Text } = Typography

interface BackfillStatusProps {
  workspaceId: string
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
}

export function BackfillStatus({ workspaceId }: BackfillStatusProps) {
  const { message } = App.useApp()
  const [lookbackDays, setLookbackDays] = useState(30)
  const {
    syncStatus,
    summary,
    taskProgress,
    startBackfill,
    cancelBackfill,
    isStarting,
    isCancelling,
    isLoading,
  } = useBackfillStatus(workspaceId)

  if (isLoading || !summary) return null

  // Return null if synced (no UI needed)
  if (syncStatus === 'synced') return null

  // Show progress bar when task is active
  const activeTask: BackfillTaskProgress | null = taskProgress || null
  if (syncStatus === 'syncing' && activeTask) {
    return (
      <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-2">
          <Space>
            <SyncOutlined spin className="text-blue-500" />
            <Text strong>
              {activeTask.status === 'pending' ? 'Preparing backfill...' : 'Backfill in progress'}
            </Text>
          </Space>
          <Popconfirm
            title="Cancel backfill?"
            description="Progress will be lost."
            onConfirm={() => {
              cancelBackfill().then(() => message.info('Backfill cancelled'))
            }}
            okText="Yes, cancel"
            cancelText="No"
          >
            <Button size="small" icon={<StopOutlined />} loading={isCancelling}>
              Cancel
            </Button>
          </Popconfirm>
        </div>

        <Progress
          percent={activeTask.progress_percent}
          status="active"
          strokeColor={{ from: '#1890ff', to: '#52c41a' }}
        />

        <div className="mt-2 text-sm text-gray-500">
          <Space split="·">
            <span>
              {activeTask.sessions.processed.toLocaleString()} /{' '}
              {activeTask.sessions.total.toLocaleString()} sessions
            </span>
            {activeTask.current_chunk && <span>Processing: {activeTask.current_chunk}</span>}
            {activeTask.estimated_remaining_seconds && activeTask.estimated_remaining_seconds > 0 && (
              <span>~{formatDuration(activeTask.estimated_remaining_seconds)} remaining</span>
            )}
          </Space>
        </div>
      </div>
    )
  }

  // Show alert when backfill is needed
  if (summary.needsBackfill) {
    return (
      <Alert
        type="info"
        showIcon
        className="!mb-4"
        message="Filter configuration has changed"
        description={
          <div className="flex items-center justify-between mt-2">
            <Text type="secondary">
              {summary.lastCompletedFilterVersion
                ? 'Historical data was processed with a different filter configuration.'
                : 'No backfill has been run yet. Run a backfill to apply filters to historical data.'}
            </Text>
            <Space>
              <Text type="secondary">Lookback:</Text>
              <InputNumber
                min={1}
                max={365}
                value={lookbackDays}
                onChange={(v) => setLookbackDays(v || 30)}
                addonAfter="days"
                style={{ width: 130 }}
              />
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  startBackfill(lookbackDays).then(() => message.success('Backfill started'))
                }}
                loading={isStarting}
              >
                Start Backfill
              </Button>
            </Space>
          </div>
        }
      />
    )
  }

  // No alert needed when everything is up to date
  return null
}
