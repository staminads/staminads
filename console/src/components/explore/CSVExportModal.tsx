import { useState } from 'react'
import { Modal, Button, Alert, Descriptions, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../../lib/api'
import { generateCSV, downloadCSV } from '../../lib/csv-utils'
import { getDimensionLabel } from '../../lib/explore-utils'
import type { DateRange, Filter } from '../../types/analytics'
import type { CustomDimensionLabels } from '../../types/workspace'

interface CSVExportModalProps {
  open: boolean
  onCancel: () => void
  workspaceId: string
  dimensions: string[]
  filters: Filter[]
  dateRange: DateRange
  timezone: string
  minSessions: number
  showComparison: boolean
  customDimensionLabels?: CustomDimensionLabels | null
}

const MAX_ROWS = 1000

/**
 * Merge comparison data matching on ALL dimensions and calculate change percentages
 */
function mergeComparisonDataForCSV(
  current: Record<string, unknown>[],
  previous: Record<string, unknown>[],
  dimensions: string[]
): Record<string, unknown>[] {
  // Build a map of previous rows keyed by all dimension values
  const prevMap = new Map<string, Record<string, unknown>>()
  for (const row of previous) {
    const key = dimensions.map(d => String(row[d] ?? '')).join('|||')
    prevMap.set(key, row)
  }

  return current.map((row) => {
    const key = dimensions.map(d => String(row[d] ?? '')).join('|||')
    const prevRow = prevMap.get(key)

    const sessions = Number(row.sessions) || 0
    const medianDuration = Number(row.median_duration) || 0
    const bounceRate = Number(row.bounce_rate) || 0
    const medianScroll = Number(row.median_scroll) || 0

    const sessionsPrev = prevRow ? Number(prevRow.sessions) || 0 : undefined
    const durationPrev = prevRow ? Number(prevRow.median_duration) || 0 : undefined
    const bouncePrev = prevRow ? Number(prevRow.bounce_rate) || 0 : undefined
    const scrollPrev = prevRow ? Number(prevRow.median_scroll) || 0 : undefined

    // Calculate change percentages
    const calcChange = (curr: number, prev: number | undefined): number | undefined => {
      if (prev === undefined || prev === 0) return undefined
      return ((curr - prev) / prev) * 100
    }

    return {
      ...row,
      sessions_prev: sessionsPrev,
      median_duration_prev: durationPrev,
      bounce_rate_prev: bouncePrev,
      median_scroll_prev: scrollPrev,
      sessions_change: calcChange(sessions, sessionsPrev),
      median_duration_change: calcChange(medianDuration, durationPrev),
      bounce_rate_change: calcChange(bounceRate, bouncePrev),
      median_scroll_change: calcChange(medianScroll, scrollPrev),
    }
  })
}

export function CSVExportModal({
  open,
  onCancel,
  workspaceId,
  dimensions,
  filters,
  dateRange,
  timezone,
  minSessions,
  showComparison,
  customDimensionLabels,
}: CSVExportModalProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      // Fetch fresh data with all dimensions flattened
      const response = await api.analytics.query({
        workspace_id: workspaceId,
        metrics: ['sessions', 'median_duration', 'bounce_rate', 'median_scroll'],
        dimensions,
        filters,
        dateRange,
        ...(showComparison && { compareDateRange: dateRange }),
        timezone,
        order: { sessions: 'desc' },
        limit: MAX_ROWS,
        havingMinSessions: minSessions,
      })

      let rows: Record<string, unknown>[]

      // Handle comparison data structure
      if (showComparison && typeof response.data === 'object' && 'current' in response.data) {
        const { current, previous } = response.data
        rows = mergeComparisonDataForCSV(current, previous, dimensions)
      } else {
        rows = response.data as Record<string, unknown>[]
      }

      // Calculate total sessions for percentage
      const totalSessions = rows.reduce((sum, row) => sum + (Number(row.sessions) || 0), 0)

      // Generate and download CSV
      const csv = generateCSV(rows, dimensions, totalSessions, showComparison, customDimensionLabels)
      downloadCSV(csv)

      message.success(`Exported ${rows.length} rows to CSV`)
      onCancel()
    } catch (error) {
      console.error('CSV export failed:', error)
      message.error('Failed to export CSV. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal
      title="Export to CSV"
      open={open}
      onCancel={onCancel}
      width={500}
      centered
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button
          key="export"
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExport}
          loading={isExporting}
        >
          Download
        </Button>,
      ]}
    >
      <Alert
        message="Export Information"
        description={
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Dimensions: {dimensions.map(d => getDimensionLabel(d, customDimensionLabels)).join(' → ')}</li>
            <li>Include only the top {MAX_ROWS} rows ordered by session count</li>
            <li>Uses current date range, filters, and minimum sessions settings</li>
            {showComparison && <li>Includes comparison period data</li>}
          </ul>
        }
        type="info"
        showIcon
        className="mt-4"
      />
      <Descriptions column={1} size="small" className="mt-4" bordered>
        <Descriptions.Item label="File name">
          explore-report-{dayjs().format('YYYY-MM-DD')}.csv
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  )
}
