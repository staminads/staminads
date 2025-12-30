import { Card, Tag, Button, Tooltip, Space, Popconfirm, Switch } from 'antd'
import { EditOutlined, DeleteOutlined, SyncOutlined, HolderOutlined, WarningOutlined } from '@ant-design/icons'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FilterWithStaleness } from '../../types/filters'
import { SOURCE_FIELDS, WRITABLE_DIMENSIONS } from '../../types/filters'

interface FilterCardProps {
  filter: FilterWithStaleness
  onEdit: () => void
  onDelete: () => void
  onBackfill: () => void
  onToggleEnabled: (enabled: boolean) => void
  isBackfilling?: boolean
}

const getFieldLabel = (field: string) => {
  const found = SOURCE_FIELDS.find((f) => f.value === field)
  return found?.label || field
}

const getDimensionLabel = (dimension: string) => {
  const found = WRITABLE_DIMENSIONS.find((d) => d.value === dimension)
  return found?.label || dimension
}

function ConditionsPreview({ filter }: { filter: FilterWithStaleness }) {
  const previewConditions = filter.conditions.slice(0, 3)
  const hasMoreConditions = filter.conditions.length > 3

  return (
    <div className="text-sm text-gray-600 space-y-1">
      <div className="text-xs text-gray-400 mb-1">Conditions:</div>
      {previewConditions.map((condition, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <span className="text-gray-400 w-4 text-right">{idx + 1}.</span>
          <span className="flex-1 truncate">
            {getFieldLabel(condition.field)} {condition.operator} "{condition.value}"
          </span>
        </div>
      ))}
      {hasMoreConditions && (
        <div className="text-gray-400 pl-6">+{filter.conditions.length - 3} more conditions</div>
      )}
    </div>
  )
}

function OperationsPreview({ filter }: { filter: FilterWithStaleness }) {
  const previewOps = filter.operations.slice(0, 3)
  const hasMore = filter.operations.length > 3

  return (
    <div className="text-sm text-gray-600 mt-2 pt-2 border-t border-gray-100">
      <div className="text-xs text-gray-400 mb-1">Operations:</div>
      {previewOps.map((op, idx) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <Tag color="blue" className="!m-0">{getDimensionLabel(op.dimension)}</Tag>
          <span className="text-gray-400">
            {op.action === 'set_value' && `= "${op.value}"`}
            {op.action === 'unset_value' && '= null'}
            {op.action === 'set_default_value' && `?= "${op.value}"`}
          </span>
        </div>
      ))}
      {hasMore && (
        <div className="text-gray-400">+{filter.operations.length - 3} more operations</div>
      )}
    </div>
  )
}

export function FilterCard({
  filter,
  onEdit,
  onDelete,
  onBackfill,
  onToggleEnabled,
  isBackfilling,
}: FilterCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: filter.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isStale = filter.staleSessionCount > 0
  const stalePercent = filter.totalSessionCount > 0
    ? Math.round((filter.staleSessionCount / filter.totalSessionCount) * 100)
    : 0

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        size="small"
        className={`mb-2 hover:shadow-sm transition-shadow ${!filter.enabled ? 'opacity-60' : ''}`}
        title={
          <div className="flex items-center gap-2">
            <span {...attributes} {...listeners} className="cursor-grab">
              <HolderOutlined className="text-gray-400" />
            </span>
            <span className={`font-medium ${!filter.enabled ? 'line-through' : ''}`}>
              {filter.name}
            </span>
            <Tag color="geekblue" className="ml-1">P{filter.priority}</Tag>
          </div>
        }
        extra={
          <Space size="small">
            <Tooltip title={filter.enabled ? 'Enabled' : 'Disabled'}>
              <Switch
                size="small"
                checked={filter.enabled}
                onChange={onToggleEnabled}
              />
            </Tooltip>
            {isStale && (
              <Tooltip title={`${filter.staleSessionCount.toLocaleString()} stale sessions (${stalePercent}%)`}>
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
              title="Delete this filter?"
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
        {/* Tags */}
        {filter.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {filter.tags.map((tag) => (
              <Tag key={tag} color="default" className="!m-0">{tag}</Tag>
            ))}
          </div>
        )}

        {isStale && (
          <div className="mb-2 p-2 bg-orange-50 rounded text-sm text-orange-700 flex items-center gap-2">
            <WarningOutlined />
            <span>{stalePercent}% of sessions need recomputation</span>
          </div>
        )}

        <ConditionsPreview filter={filter} />
        <OperationsPreview filter={filter} />
      </Card>
    </div>
  )
}
