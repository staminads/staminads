import { Card, Tag, Button, Tooltip, Space, Popconfirm } from 'antd'
import { EditOutlined, DeleteOutlined, SyncOutlined, HolderOutlined, WarningOutlined } from '@ant-design/icons'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CustomDimensionWithStaleness } from '../../types/custom-dimensions'
import { SOURCE_FIELDS } from '../../types/custom-dimensions'

interface DimensionCardProps {
  dimension: CustomDimensionWithStaleness
  onEdit: () => void
  onDelete: () => void
  onBackfill: () => void
  isBackfilling?: boolean
}

const getFieldLabel = (field: string) => {
  const found = SOURCE_FIELDS.find((f) => f.value === field)
  return found?.label || field
}

function RulePreview({ dimension }: { dimension: CustomDimensionWithStaleness }) {
  const previewRules = dimension.rules.slice(0, 3)
  const hasMore = dimension.rules.length > 3

  return (
    <div className="text-sm text-gray-600 space-y-1">
      {previewRules.map((rule, idx) => {
        const conditionSummary = rule.conditions
          .slice(0, 2)
          .map((c) => `${getFieldLabel(c.field)} ${c.operator} "${c.value}"`)
          .join(' AND ')
        const hasMoreConditions = rule.conditions.length > 2
        return (
          <div key={idx} className="flex items-start gap-2">
            <span className="text-gray-400 w-4 text-right">{idx + 1}.</span>
            <span className="flex-1 truncate">
              {conditionSummary}
              {hasMoreConditions && ' ...'}
              <span className="text-gray-400"> → </span>
              <span className="font-medium">{rule.outputValue}</span>
            </span>
          </div>
        )
      })}
      {hasMore && (
        <div className="text-gray-400 pl-6">+{dimension.rules.length - 3} more rules</div>
      )}
      {dimension.defaultValue && (
        <div className="text-gray-400 pl-6 mt-1 pt-1 border-t border-gray-100">
          Default: {dimension.defaultValue}
        </div>
      )}
    </div>
  )
}

export function DimensionCard({
  dimension,
  onEdit,
  onDelete,
  onBackfill,
  isBackfilling,
}: DimensionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dimension.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isStale = dimension.staleSessionCount > 0
  const stalePercent = dimension.totalSessionCount > 0
    ? Math.round((dimension.staleSessionCount / dimension.totalSessionCount) * 100)
    : 0

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        size="small"
        className="mb-2 hover:shadow-sm transition-shadow"
        title={
          <div className="flex items-center gap-2">
            <span {...attributes} {...listeners} className="cursor-grab">
              <HolderOutlined className="text-gray-400" />
            </span>
            <span className="font-medium">{dimension.name}</span>
            <Tag color="purple" className="ml-1">cd_{dimension.slot}</Tag>
          </div>
        }
        extra={
          <Space size="small">
            {isStale && (
              <Tooltip title={`${dimension.staleSessionCount.toLocaleString()} stale sessions (${stalePercent}%)`}>
                <Button
                  type="text"
                  size="small"
                  icon={<SyncOutlined spin={isBackfilling} />}
                  onClick={onBackfill}
                  loading={isBackfilling}
                  className="!text-orange-500"
                >
                  Backfill
                </Button>
              </Tooltip>
            )}
            <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} />
            <Popconfirm
              title="Delete this custom dimension?"
              description="This action cannot be undone."
              onConfirm={onDelete}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Button type="text" size="small" icon={<DeleteOutlined />} danger />
            </Popconfirm>
          </Space>
        }
      >
        {isStale && (
          <div className="mb-2 p-2 bg-orange-50 rounded text-sm text-orange-700 flex items-center gap-2">
            <WarningOutlined />
            <span>{stalePercent}% of sessions need recomputation</span>
          </div>
        )}
        <RulePreview dimension={dimension} />
      </Card>
    </div>
  )
}
