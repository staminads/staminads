import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Tag, Button, Switch, Popconfirm, Space, Tooltip, Popover } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
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
  if (customLabels && dimension.startsWith('cd_')) {
    const slot = dimension.replace('cd_', '')
    if (customLabels[slot]) {
      return customLabels[slot]
    }
  }
  const dimInfo = WRITABLE_DIMENSIONS.find((d) => d.value === dimension)
  return dimInfo?.label || dimension
}

export function FilterTable({ workspaceId, filters, onEdit, searchText = '', customDimensionLabels }: FilterTableProps) {
  const queryClient = useQueryClient()

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
              c.value.toLowerCase().includes(lower)
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
  )
}
