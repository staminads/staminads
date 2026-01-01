import { useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { backfillSummaryQueryOptions } from '../lib/queries'

export type SyncStatus = 'synced' | 'syncing' | 'needs_backfill' | 'error'

export function useBackfillStatus(workspaceId: string) {
  const queryClient = useQueryClient()

  // Query for summary
  const { data: summary, isLoading } = useQuery(backfillSummaryQueryOptions(workspaceId))

  // Polling for active task (2s interval, stops when done)
  const activeTaskId = summary?.activeTask?.id
  const { data: taskProgress } = useQuery({
    queryKey: ['backfill', 'status', activeTaskId],
    queryFn: () => api.filters.backfillStatus(activeTaskId!),
    enabled: !!activeTaskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        return false
      }
      return 2000
    },
  })

  // Invalidate on completion
  useEffect(() => {
    if (
      taskProgress?.status === 'completed' ||
      taskProgress?.status === 'failed' ||
      taskProgress?.status === 'cancelled'
    ) {
      queryClient.invalidateQueries({ queryKey: ['backfill', 'summary', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
    }
  }, [taskProgress?.status, queryClient, workspaceId])

  // Mutations
  const startMutation = useMutation({
    mutationFn: (lookbackDays: number) =>
      api.filters.backfillStart({ workspace_id: workspaceId, lookback_days: lookbackDays }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backfill', 'summary', workspaceId] })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.filters.backfillCancel(activeTaskId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backfill', 'summary', workspaceId] })
    },
  })

  // Compute sync status
  const syncStatus: SyncStatus = useMemo(() => {
    const activeStatus = taskProgress?.status || summary?.activeTask?.status
    if (activeStatus === 'running' || activeStatus === 'pending') return 'syncing'
    if (taskProgress?.status === 'failed') return 'error'
    if (summary?.needsBackfill) return 'needs_backfill'
    return 'synced'
  }, [summary, taskProgress])

  return {
    summary,
    taskProgress: taskProgress || summary?.activeTask,
    isLoading,
    syncStatus,
    startBackfill: startMutation.mutateAsync,
    cancelBackfill: cancelMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isCancelling: cancelMutation.isPending,
  }
}
