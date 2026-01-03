import { useState, useCallback, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Alert } from 'antd'
import { workspaceQueryOptions, analyticsQueryOptions } from '../../../../lib/queries'
import { useExploreParams } from '../../../../hooks/useExploreParams'
import { useAssistant } from '../../../../hooks/useAssistant'
import { useBreakdown } from '../../../../hooks/useBreakdown'
import { ExploreFilters } from '../../../../components/explore/ExploreFilters'
import { ExploreTable } from '../../../../components/explore/ExploreTable'
import { ExploreTemplates } from '../../../../components/explore/ExploreTemplates'
import { ExploreSummary } from '../../../../components/explore/ExploreSummary'
import { AssistantButton } from '../../../../components/explore/AssistantButton'
import { AssistantPanel } from '../../../../components/explore/AssistantPanel'
import { BreakdownDrawer } from '../../../../components/explore/BreakdownDrawer'
import { BreakdownModal } from '../../../../components/explore/BreakdownModal'
import { CSVExportModal } from '../../../../components/explore/CSVExportModal'
import { CSVExportButton } from '../../../../components/explore/CSVExportButton'
import { DateRangePicker } from '../../../../components/dashboard/DateRangePicker'
import { ComparisonPicker } from '../../../../components/dashboard/ComparisonPicker'
import {
  calculateChildrenDimensionsAndFilters,
  transformApiRowsToExploreRows,
  mergeComparisonData,
  insertChildrenIntoTree,
  setRowLoading,
} from '../../../../lib/explore-utils'
import { api } from '../../../../lib/api'
import type { ExploreRow, ExploreTotals } from '../../../../types/explore'
import type { DatePreset, Filter } from '../../../../types/analytics'
import type { ExploreConfigOutput } from '../../../../types/assistant'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/explore')({
  component: Explore,
})

function Explore() {
  const { workspaceId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  const {
    dimensions,
    filters,
    minSessions,
    period,
    timezone,
    comparison,
    customStart,
    customEnd,
    setDimensions,
    setFilters,
    setMinSessions,
    setPeriod,
    setTimezone: _setTimezone,
    setComparison,
    setCustomRange,
    setAll,
  } = useExploreParams(workspace.timezone)

  // AI Assistant state
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const {
    messages: assistantMessages,
    status: assistantStatus,
    usage: assistantUsage,
    isStreaming: isAssistantStreaming,
    sendPrompt,
    clearMessages,
  } = useAssistant(workspaceId)

  // Compute date range (needed for breakdown hook)
  const dateRange = period === 'custom' && customStart && customEnd
    ? { start: customStart, end: customEnd }
    : { preset: period as DatePreset }

  // Breakdown drawer state
  const {
    state: breakdownState,
    openForRow: openBreakdown,
    confirmWithDimensions: confirmBreakdown,
    close: closeBreakdown,
    prefetchForRow: prefetchBreakdown,
  } = useBreakdown({
    workspaceId,
    dimensions,
    baseFilters: filters,
    dateRange,
    timezone,
    minSessions,
  })

  // Handle config from assistant - use setAll for atomic update
  const handleAssistantConfig = useCallback((config: ExploreConfigOutput) => {
    console.log('[AssistantConfig] Received config:', JSON.stringify(config, null, 2))

    // Ensure minSessions is a number (AI may return string)
    let minSessions: number | undefined
    if (config.minSessions !== undefined) {
      const parsed = Number(config.minSessions)
      if (!isNaN(parsed) && parsed >= 1) {
        minSessions = parsed
      }
    }

    // Use setAll for atomic update (prevents race conditions)
    setAll({
      dimensions: config.dimensions,
      filters: config.filters,
      period: config.period,
      comparison: config.comparison,
      minSessions,
      customStart: config.customStart,
      customEnd: config.customEnd,
    })

    // Close panel after applying
    setIsAssistantOpen(false)
  }, [setAll])

  // Handle send with current state
  const handleAssistantSend = useCallback((prompt: string) => {
    sendPrompt(prompt, {
      dimensions,
      filters,
      period,
      comparison,
      minSessions,
      customStart,
      customEnd,
    })
  }, [sendPrompt, dimensions, filters, period, comparison, minSessions, customStart, customEnd])

  // Handle template selection (dimensions + optional filters)
  const handleSelectTemplate = useCallback((dims: string[], templateFilters?: Filter[]) => {
    if (templateFilters && templateFilters.length > 0) {
      setAll({ dimensions: dims, filters: templateFilters })
    } else {
      setDimensions(dims)
    }
  }, [setAll, setDimensions])

  // State for the hierarchical data
  const [reportData, setReportData] = useState<ExploreRow[]>([])
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([])
  const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set())
  const [maxMedianDuration, setMaxMedianDuration] = useState<number>(0)
  const [isCSVModalOpen, setIsCSVModalOpen] = useState(false)

  const showComparison = comparison !== 'none'

  // Initial data query - fetch first dimension only
  const initialQuery = dimensions.length > 0 ? {
    workspace_id: workspaceId,
    metrics: ['sessions', 'median_duration', 'bounce_rate', 'max_scroll'],
    dimensions: [dimensions[0]],
    filters,
    dateRange,
    ...(showComparison && { compareDateRange: dateRange }),
    timezone,
    order: { sessions: 'desc' as const },
    limit: 100,
    havingMinSessions: minSessions,
  } : null

  const {
    data: initialResponse,
    isFetching: isInitialFetching,
    isError,
    error,
  } = useQuery({
    ...analyticsQueryOptions(initialQuery!),
    enabled: dimensions.length > 0,
    placeholderData: keepPreviousData,
  })

  // Query for extremes (min/max median_duration) for heat map coloring
  // Groups by ALL dimensions to find true global max across all dimension combinations
  const { data: extremesData } = useQuery({
    queryKey: ['explore', 'extremes', workspaceId, dimensions, dateRange, filters, minSessions, timezone],
    queryFn: () => api.analytics.extremes({
      workspace_id: workspaceId,
      metric: 'median_duration',
      groupBy: dimensions,
      dateRange,
      filters,
      timezone,
      havingMinSessions: minSessions,
    }),
    enabled: dimensions.length > 0,
    staleTime: 30_000,
  })

  // Query for overall totals (no dimensions = single aggregate row)
  // Used for percentages and summary header
  const { data: totalsResponse } = useQuery({
    queryKey: ['explore', 'totals', workspaceId, dateRange, filters, timezone, showComparison],
    queryFn: () => api.analytics.query({
      workspace_id: workspaceId,
      metrics: ['sessions', 'median_duration', 'bounce_rate', 'max_scroll'],
      dimensions: [], // Empty = no grouping = totals
      filters,
      dateRange,
      ...(showComparison && { compareDateRange: dateRange }),
      timezone,
      // Note: no havingMinSessions - we want true totals
    }),
    enabled: dimensions.length > 0,
    staleTime: 60_000, // Longer stale time since totals change less frequently
  })

  // Extract totals from response, handling comparison data
  const totals: ExploreTotals | undefined = (() => {
    if (!totalsResponse?.data) return undefined

    if (showComparison && typeof totalsResponse.data === 'object' && 'current' in totalsResponse.data) {
      const { current, previous } = totalsResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      const curr = current[0] || {}
      const prev = previous[0] || {}

      const currSessions = Number(curr.sessions) || 0
      const prevSessions = Number(prev.sessions) || 0
      const currDuration = Number(curr.median_duration) || 0
      const prevDuration = Number(prev.median_duration) || 0
      const currBounceRate = Number(curr.bounce_rate) || 0
      const prevBounceRate = Number(prev.bounce_rate) || 0
      const currMaxScroll = Number(curr.max_scroll) || 0
      const prevMaxScroll = Number(prev.max_scroll) || 0

      return {
        sessions: currSessions,
        median_duration: currDuration,
        bounce_rate: currBounceRate,
        max_scroll: currMaxScroll,
        sessions_prev: prevSessions,
        median_duration_prev: prevDuration,
        bounce_rate_prev: prevBounceRate,
        max_scroll_prev: prevMaxScroll,
        sessions_change: prevSessions > 0 ? ((currSessions - prevSessions) / prevSessions) * 100 : undefined,
        median_duration_change: prevDuration > 0 ? ((currDuration - prevDuration) / prevDuration) * 100 : undefined,
        bounce_rate_change: prevBounceRate > 0 ? ((currBounceRate - prevBounceRate) / prevBounceRate) * 100 : undefined,
        max_scroll_change: prevMaxScroll > 0 ? ((currMaxScroll - prevMaxScroll) / prevMaxScroll) * 100 : undefined,
      }
    }

    const row = (totalsResponse.data as Record<string, unknown>[])[0] || {}
    return {
      sessions: Number(row.sessions) || 0,
      median_duration: Number(row.median_duration) || 0,
      bounce_rate: Number(row.bounce_rate) || 0,
      max_scroll: Number(row.max_scroll) || 0,
    }
  })()

  // Transform initial response into ExploreRow format
  useEffect(() => {
    if (!initialResponse || dimensions.length === 0) {
      setReportData([])
      setMaxMedianDuration(0)
      return
    }

    const currentDimension = dimensions[0]
    let rows: Record<string, unknown>[]

    // Handle comparison data
    if (showComparison && typeof initialResponse.data === 'object' && 'current' in initialResponse.data) {
      const { current, previous } = initialResponse.data as {
        current: Record<string, unknown>[]
        previous: Record<string, unknown>[]
      }
      rows = mergeComparisonData(current, previous, currentDimension)
    } else {
      rows = initialResponse.data as Record<string, unknown>[]
    }

    // Guard against non-array response (e.g., API error)
    if (!Array.isArray(rows)) {
      console.error('Invalid API response: expected array, got', typeof rows)
      setReportData([])
      setMaxMedianDuration(0)
      return
    }

    const exploreRows = transformApiRowsToExploreRows(
      rows,
      dimensions,
      0,
      null,
      showComparison,
    )

    setReportData(exploreRows)

    // Use server-side max for heat map (from extremes query)
    // Fall back to client-side calculation if extremes not available yet
    if (extremesData?.max !== null && extremesData?.max !== undefined) {
      setMaxMedianDuration(extremesData.max)
    } else {
      const maxDuration = Math.max(...exploreRows.map((r) => r.median_duration), 0)
      setMaxMedianDuration(maxDuration)
    }

    // Reset expanded rows when dimensions change
    setExpandedRowKeys([])
  }, [initialResponse, dimensions, showComparison, extremesData])

  // Fetch children for a row
  const fetchChildren = useCallback(
    async (record: ExploreRow) => {
      if (record.childrenLoaded || record.isLoading) {
        return
      }

      // Mark row as loading
      setLoadingRows((prev) => new Set(prev).add(record.key))
      setReportData((prev) => setRowLoading(prev, record.key, true))

      try {
        // Calculate query params for children
        const { dimensionsToFetch, filters: childFilters } = calculateChildrenDimensionsAndFilters(
          record,
          dimensions,
          filters,
        )

        const query = {
          workspace_id: workspaceId,
          metrics: ['sessions', 'median_duration', 'bounce_rate', 'max_scroll'],
          dimensions: dimensionsToFetch,
          filters: childFilters,
          dateRange,
          ...(showComparison && { compareDateRange: dateRange }),
          timezone,
          order: { sessions: 'desc' as const },
          limit: 100,
          havingMinSessions: minSessions,
        }

        // Use queryClient.fetchQuery for caching child data
        const response = await queryClient.fetchQuery({
          queryKey: ['explore', 'children', record.key, workspaceId, dimensionsToFetch, childFilters, dateRange, timezone, minSessions, showComparison],
          queryFn: () => api.analytics.query(query),
          staleTime: 30_000, // 30 seconds
        })

        // Current dimension index for children
        const childDimensionIndex = record.parentDimensionIndex + 1
        const childDimension = dimensions[childDimensionIndex]

        let rows: Record<string, unknown>[]

        // Handle comparison data
        if (showComparison && typeof response.data === 'object' && 'current' in response.data) {
          const { current, previous } = response.data as {
            current: Record<string, unknown>[]
            previous: Record<string, unknown>[]
          }
          rows = mergeComparisonData(current, previous, childDimension)
        } else {
          rows = response.data as Record<string, unknown>[]
        }

        const childRows = transformApiRowsToExploreRows(
          rows,
          dimensions,
          childDimensionIndex,
          record.key,
          showComparison,
        )

        // Check if children were likely filtered out by min sessions threshold
        const childrenFilteredByMinSessions = childRows.length === 0 && minSessions > 1

        // Insert children into tree
        setReportData((prev) => insertChildrenIntoTree(prev, record.key, childRows, childrenFilteredByMinSessions))

        // Update max if children have higher median_duration values
        const childrenMax = Math.max(...childRows.map(r => r.median_duration), 0)
        if (childrenMax > maxMedianDuration) {
          setMaxMedianDuration(childrenMax)
        }
      } catch (err) {
        console.error('Failed to fetch children:', err)
        // Mark row as not loading on error
        setReportData((prev) => setRowLoading(prev, record.key, false))
      } finally {
        setLoadingRows((prev) => {
          const next = new Set(prev)
          next.delete(record.key)
          return next
        })
      }
    },
    [dimensions, filters, workspaceId, dateRange, showComparison, timezone, minSessions, queryClient, maxMedianDuration],
  )

  // Handle row expansion
  const handleExpand = useCallback(
    (expanded: boolean, record: ExploreRow) => {
      if (expanded && !record.childrenLoaded) {
        fetchChildren(record)
      }
    },
    [fetchChildren],
  )

  if (isError) {
    return (
      <div className="flex-1 p-6">
        <h1 className="text-2xl font-light text-gray-800 mb-4">Explore</h1>
        <Alert
          message="Error loading data"
          description={error instanceof Error ? error.message : 'An unexpected error occurred'}
          type="error"
          showIcon
        />
      </div>
    )
  }

  // Show template grid when no dimensions selected
  if (dimensions.length === 0) {
    return (
      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-light text-gray-800">Explore</h1>
          <div className="flex items-center gap-2">
            <DateRangePicker
              period={period}
              timezone={timezone}
              customStart={customStart}
              customEnd={customEnd}
              onPeriodChange={setPeriod}
              onCustomRangeChange={setCustomRange}
              size="small"
            />
            <ComparisonPicker value={comparison} onChange={setComparison} size="small" />
          </div>
        </div>

        <p className="text-gray-500 mb-6">Select a report template to get started, or create your own custom report.</p>

        <ExploreTemplates
          onSelectTemplate={handleSelectTemplate}
          onOpenAssistant={() => setIsAssistantOpen(true)}
          customDimensionLabels={workspace.settings.custom_dimensions}
        />

        {/* AI Assistant */}
        <AssistantButton
          isOpen={isAssistantOpen}
          onClick={() => setIsAssistantOpen(!isAssistantOpen)}
          hasMessages={assistantMessages.length > 0}
        />

        {isAssistantOpen && (
          <AssistantPanel
            messages={assistantMessages}
            status={assistantStatus}
            usage={assistantUsage}
            isStreaming={isAssistantStreaming}
            onSend={handleAssistantSend}
            onClear={clearMessages}
            onClose={() => setIsAssistantOpen(false)}
            onApplyConfig={handleAssistantConfig}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-light text-gray-800">Explore</h1>
        <div className="flex items-center gap-2">
          <CSVExportButton
            onClick={() => setIsCSVModalOpen(true)}
            disabled={reportData.length === 0}
          />
          <DateRangePicker
            period={period}
            timezone={timezone}
            customStart={customStart}
            customEnd={customEnd}
            onPeriodChange={setPeriod}
            onCustomRangeChange={setCustomRange}
            size="small"
          />
          <ComparisonPicker value={comparison} onChange={setComparison} size="small" />
        </div>
      </div>

      <ExploreFilters
        dimensions={dimensions}
        onDimensionsChange={setDimensions}
        filters={filters}
        onFiltersChange={setFilters}
        minSessions={minSessions}
        onMinSessionsChange={setMinSessions}
        customDimensionLabels={workspace.settings.custom_dimensions}
      />

      <ExploreSummary
        totals={totals}
        showComparison={showComparison}
        loading={isInitialFetching && !totals}
        bestTimeScore={extremesData?.max ?? undefined}
        maxMedianDuration={maxMedianDuration}
        timescoreReference={workspace.settings.timescore_reference ?? 60}
        maxDimensionValues={extremesData?.maxDimensionValues}
        customDimensionLabels={workspace.settings.custom_dimensions}
      />

      <div className="rounded-md overflow-hidden">
        <ExploreTable
          data={reportData}
          dimensions={dimensions}
          expandedRowKeys={expandedRowKeys}
          onExpand={handleExpand}
          onExpandedRowsChange={setExpandedRowKeys}
          loadingRows={loadingRows}
          maxMedianDuration={maxMedianDuration}
          timescoreReference={workspace.settings.timescore_reference ?? 60}
          showComparison={showComparison}
          loading={isInitialFetching && reportData.length === 0}
          customDimensionLabels={workspace.settings.custom_dimensions}
          totals={totals}
          onBreakdownClick={openBreakdown}
          onBreakdownHover={prefetchBreakdown}
          minSessions={minSessions}
          maxDimensionValues={extremesData?.maxDimensionValues}
        />
      </div>

      {/* AI Assistant */}
      <AssistantButton
        isOpen={isAssistantOpen}
        onClick={() => setIsAssistantOpen(!isAssistantOpen)}
        hasMessages={assistantMessages.length > 0}
      />

      {isAssistantOpen && (
        <AssistantPanel
          messages={assistantMessages}
          status={assistantStatus}
          usage={assistantUsage}
          isStreaming={isAssistantStreaming}
          onSend={handleAssistantSend}
          onClear={clearMessages}
          onClose={() => setIsAssistantOpen(false)}
          onApplyConfig={handleAssistantConfig}
        />
      )}

      {/* Breakdown Dimension Selector Modal */}
      <BreakdownModal
        open={breakdownState?.isModalOpen ?? false}
        onCancel={closeBreakdown}
        onSubmit={confirmBreakdown}
        excludeDimensions={dimensions.slice(0, (breakdownState?.selectedRow?.parentDimensionIndex ?? -1) + 1)}
        initialDimensions={breakdownState?.breakdownDimensions ?? []}
        customDimensionLabels={workspace.settings.custom_dimensions}
      />

      {/* Breakdown Drawer */}
      {breakdownState?.isDrawerOpen && breakdownState.selectedRow && (
        <BreakdownDrawer
          open={breakdownState.isDrawerOpen}
          onClose={closeBreakdown}
          workspaceId={workspaceId}
          selectedRow={breakdownState.selectedRow}
          breakdownDimensions={breakdownState.breakdownDimensions}
          parentFilters={breakdownState.parentFilters}
          dateRange={dateRange}
          timezone={timezone}
          minSessions={minSessions}
          timescoreReference={workspace.settings.timescore_reference ?? 60}
          customDimensionLabels={workspace.settings.custom_dimensions}
          dimensions={dimensions}
        />
      )}

      {/* CSV Export Modal */}
      <CSVExportModal
        open={isCSVModalOpen}
        onCancel={() => setIsCSVModalOpen(false)}
        workspaceId={workspaceId}
        dimensions={dimensions}
        filters={filters}
        dateRange={dateRange}
        timezone={timezone}
        minSessions={minSessions}
        showComparison={showComparison}
        customDimensionLabels={workspace.settings.custom_dimensions}
      />
    </div>
  )
}
