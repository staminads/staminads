import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Tag, Button, Switch, Popconfirm, Space, Tooltip, Popover } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { ChevronDown } from 'lucide-react'
import type { ColumnsType } from 'antd/es/table'
import { api } from '../../lib/api'
import type { FilterWithStaleness } from '../../types/filters'
import { WRITABLE_DIMENSIONS } from '../../types/filters'
import type { CustomDimensionLabels } from '../../types/workspace'

interface FilterTableProps {
  workspaceId: string
  filters: FilterWithStaleness[]
  onEdit: (filter: FilterWithStaleness) => void
  searchText?: string
  customDimensionLabels?: CustomDimensionLabels | null
}

function getDimensionLabel(dimension: string, customLabels?: CustomDimensionLabels | null): string {
  if (customLabels && dimension.startsWith('stm_')) {
    const slot = dimension.replace('stm_', '')
    if (customLabels[slot]) {
      return customLabels[slot]
    }
  }
  const dimInfo = WRITABLE_DIMENSIONS.find((d) => d.value === dimension)
  return dimInfo?.label || dimension
}

function MobileFilterCard({
  filter,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onToggleEnabled,
  customDimensionLabels,
}: {
  filter: FilterWithStaleness
  isExpanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  customDimensionLabels?: CustomDimensionLabels | null
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-3">
      {/* Header */}
      <div className="flex items-center justify-between cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${!filter.enabled ? 'text-gray-400' : ''}`}>
            {filter.name}
          </div>
          {filter.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {filter.tags.map((tag) => (
                <Tag key={tag} className="text-xs">{tag}</Tag>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={filter.enabled}
            size="small"
            onClick={(_, e) => {
              e.stopPropagation()
              onToggleEnabled()
            }}
          />
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
          {/* Priority */}
          <div className="text-sm">
            <span className="text-gray-500">Priority:</span>
            <span className="font-medium ml-1">{filter.priority}</span>
          </div>

          {/* Conditions */}
          <div>
            <div className="text-xs text-gray-400 uppercase font-medium mb-2">Conditions</div>
            {filter.conditions.length === 0 ? (
              <span className="text-gray-400 italic text-sm">(always matches)</span>
            ) : (
              <div className="space-y-2">
                {filter.conditions.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1 text-sm">
                    <Tag bordered={false} color="green">{c.field}</Tag>
                    <Tag bordered={false} color="blue">{c.operator}</Tag>
                    <Tag>{c.value}</Tag>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operations */}
          <div>
            <div className="text-xs text-gray-400 uppercase font-medium mb-2">Operations</div>
            <div className="space-y-2">
              {filter.operations.map((op, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1 text-sm">
                  <Tag bordered={false} color="purple">
                    {getDimensionLabel(op.dimension, customDimensionLabels)}
                  </Tag>
                  <Tag bordered={false} color="orange">
                    {op.action === 'set_value' && 'set to'}
                    {op.action === 'unset_value' && 'unset'}
                    {op.action === 'set_default_value' && 'default to'}
                  </Tag>
                  {op.action !== 'unset_value' && op.value && <Tag>{op.value}</Tag>}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Popconfirm title="Delete this filter?" onConfirm={onDelete} okText="Delete">
              <Button block size="small" icon={<DeleteOutlined />}>
                Delete
              </Button>
            </Popconfirm>
            <Button block size="small" icon={<EditOutlined />} onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function FilterTable({ workspaceId, filters, onEdit, searchText = '', customDimensionLabels }: FilterTableProps) {
  const queryClient = useQueryClient()
  const [mobileExpandedKeys, setMobileExpandedKeys] = useState<Set<string>>(new Set())

  const toggleMobileExpand = (id: string) => {
    setMobileExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deleteMutation = useMutation({
    mutationFn: (filterId: string) => api.filters.delete(workspaceId, filterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['backfill', 'summary', workspaceId] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; enabled: boolean }) =>
      api.filters.update({ workspace_id: workspaceId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['backfill', 'summary', workspaceId] })
    },
  })

  // Sort by priority descending, then filter by search
  const displayFilters = useMemo(() => {
    let result = [...filters].sort((a, b) => b.priority - a.priority)
    if (searchText) {
      const lower = searchText.toLowerCase()
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(lower) ||
          f.conditions.some(
            (c) =>
              c.field.toLowerCase().includes(lower) ||
              (c.value?.toLowerCase().includes(lower) ?? false)
          ) ||
          f.operations.some((op) => op.dimension.toLowerCase().includes(lower))
      )
    }
    return result
  }, [filters, searchText])

  const columns: ColumnsType<FilterWithStaleness> = [
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      render: (priority: number) => (
        <span className="text-gray-600">{priority}</span>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <span className={!record.enabled ? 'text-gray-400' : 'font-medium'}>
          {name}
        </span>
      ),
    },
    {
      title: 'Conditions',
      key: 'conditions',
      render: (_, record) => {
        if (record.conditions.length === 0) {
          return <span className="text-gray-400 italic">(always matches)</span>
        }
        const visibleConditions = record.conditions.slice(0, 2)
        const hiddenConditions = record.conditions.slice(2)
        const hiddenCount = hiddenConditions.length
        return (
          <div className="flex flex-col gap-1">
            {visibleConditions.map((c, i) => (
              <div key={i} className="inline-flex items-center gap-1 text-sm">
                <Tag bordered={false} color="green">{c.field}</Tag>
                <Tag bordered={false} color="blue">{c.operator}</Tag>
                <Tag>{c.value}</Tag>
              </div>
            ))}
            {hiddenCount > 0 && (
              <Popover
                content={
                  <div className="flex flex-col gap-1">
                    {hiddenConditions.map((c, i) => (
                      <div key={i} className="inline-flex items-center gap-1 text-sm">
                        <Tag bordered={false} color="green">{c.field}</Tag>
                        <Tag bordered={false} color="blue">{c.operator}</Tag>
                        <Tag>{c.value}</Tag>
                      </div>
                    ))}
                  </div>
                }
              >
                <span className="text-gray-400 text-xs cursor-pointer hover:text-gray-600">
                  +{hiddenCount} more
                </span>
              </Popover>
            )}
          </div>
        )
      },
    },
    {
      title: 'Operations',
      key: 'operations',
      render: (_, record) => (
        <div className="flex flex-col gap-1">
          {record.operations.map((op, i) => (
            <div key={i} className="inline-flex items-center gap-1 text-sm">
              <Tooltip title={op.dimension}>
                <Tag bordered={false} color="purple">
                  {getDimensionLabel(op.dimension, customDimensionLabels)}
                </Tag>
              </Tooltip>
              <Tag bordered={false} color="orange">
                {op.action === 'set_value' && 'set to'}
                {op.action === 'unset_value' && 'unset'}
                {op.action === 'set_default_value' && 'default to'}
              </Tag>
              {op.action !== 'unset_value' && op.value && <Tag>{op.value}</Tag>}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[]) => (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 80,
      render: (_, record) => (
        <Popconfirm
          title={record.enabled ? 'Disable this filter?' : 'Enable this filter?'}
          onConfirm={() =>
            updateMutation.mutate({ id: record.id, enabled: !record.enabled })
          }
          okText="Yes"
          cancelText="No"
        >
          <Switch checked={record.enabled} size="small" />
        </Popconfirm>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      className: 'actions-cell',
      render: (_, record) => (
        <Space
          size="small"
          className="opacity-0 transition-opacity [.ant-table-row:hover_&]:opacity-100"
        >
          <Popconfirm
            title="Delete this filter?"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="Delete"
          >
            <Button type="text" size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onEdit(record)}
          />
        </Space>
      ),
    },
  ]

  const handleRowClick = (record: FilterWithStaleness, e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const isInteractive = target.closest(
      '.ant-switch, .ant-popover, .ant-btn, button, .ant-tag'
    )
    if (isInteractive) return
    onEdit(record)
  }

  return (
    <>
      {/* Mobile: Card view */}
      <div className="md:hidden">
        {displayFilters.map(filter => (
          <MobileFilterCard
            key={filter.id}
            filter={filter}
            isExpanded={mobileExpandedKeys.has(filter.id)}
            onToggle={() => toggleMobileExpand(filter.id)}
            onEdit={() => onEdit(filter)}
            onDelete={() => deleteMutation.mutate(filter.id)}
            onToggleEnabled={() => updateMutation.mutate({ id: filter.id, enabled: !filter.enabled })}
            customDimensionLabels={customDimensionLabels}
          />
        ))}
      </div>

      {/* Desktop: Table view */}
      <div className="hidden md:block">
        <Table
          dataSource={displayFilters}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          onRow={(record) => ({
            onClick: (e) => handleRowClick(record, e),
            className: 'cursor-pointer',
          })}
        />
      </div>
    </>
  )
}
