import { useState } from 'react'
import { Button, Popover, Tooltip, Progress, Space, InputNumber } from 'antd'
import { SyncOutlined, ExclamationCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useBackfillStatus } from '../../hooks/useBackfillStatus'
import type { SyncStatus } from '../../hooks/useBackfillStatus'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
}

interface SyncStatusIconProps {
  workspaceId: string
}

export function SyncStatusIcon({ workspaceId }: SyncStatusIconProps) {
  const { syncStatus, taskProgress, startBackfill, cancelBackfill, isStarting, isCancelling } =
    useBackfillStatus(workspaceId)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [lookbackDays, setLookbackDays] = useState(30)

  // Don't render when synced
  if (syncStatus === 'synced') return null

  // Icon based on status
  const iconMap: Record<Exclude<SyncStatus, 'synced'>, React.ReactNode> = {
    syncing: <SyncOutlined spin className="text-blue-500" />,
    needs_backfill: <ExclamationCircleOutlined className="text-orange-500" />,
    error: <CloseCircleOutlined className="text-red-500" />,
  }

  // Tooltip text
  const tooltipMap: Record<Exclude<SyncStatus, 'synced'>, string> = {
    syncing: 'Syncing filters...',
    needs_backfill: 'Filters need sync',
    error: 'Sync failed',
  }

  const handleStartBackfill = async () => {
    await startBackfill(lookbackDays)
    setPopoverOpen(false) // Auto-close after starting
  }

  // Popover content based on status
  const popoverContent = (
    <div className="w-64">
      {syncStatus === 'syncing' && (
        <>
          <div className="font-medium mb-2">Syncing filters...</div>
          <Progress percent={taskProgress?.progress_percent ?? 0} size="small" />
          <div className="text-xs text-gray-500 mt-2">
            {taskProgress?.sessions.processed.toLocaleString()} /{' '}
            {taskProgress?.sessions.total.toLocaleString()} sessions
          </div>
          {taskProgress?.estimated_remaining_seconds != null &&
            taskProgress.estimated_remaining_seconds > 0 && (
              <div className="text-xs text-gray-500">
                ~{formatDuration(taskProgress.estimated_remaining_seconds)} remaining
              </div>
            )}
          <Button size="small" onClick={() => cancelBackfill()} loading={isCancelling} className="mt-2">
            Cancel
          </Button>
        </>
      )}
      {syncStatus === 'needs_backfill' && (
        <>
          <div className="font-medium mb-2">Filters out of sync</div>
          <div className="text-xs text-gray-500 mb-2">Historical data needs to be reprocessed.</div>
          <Space>
            <InputNumber
              min={1}
              max={365}
              value={lookbackDays}
              onChange={(v) => setLookbackDays(v || 30)}
              addonAfter="days"
              size="small"
              style={{ width: 120 }}
            />
            <Button type="primary" size="small" onClick={handleStartBackfill} loading={isStarting}>
              Sync
            </Button>
          </Space>
        </>
      )}
      {syncStatus === 'error' && (
        <>
          <div className="font-medium text-red-600 mb-2">Sync failed</div>
          <div className="text-xs text-gray-500 mb-2">{taskProgress?.error_message}</div>
          <Button size="small" onClick={handleStartBackfill} loading={isStarting}>
            Retry
          </Button>
        </>
      )}
    </div>
  )

  return (
    <Tooltip title={tooltipMap[syncStatus]}>
      <Popover
        content={popoverContent}
        trigger="click"
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
      >
        <Button
          type="text"
          icon={iconMap[syncStatus]}
          className="!text-gray-500 hover:!text-gray-800 hover:!bg-gray-100"
        />
      </Popover>
    </Tooltip>
  )
}
