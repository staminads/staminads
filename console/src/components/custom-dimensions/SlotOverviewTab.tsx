import { Table, Button, Tag, Space, Popconfirm, message } from 'antd'
import { EditOutlined, DeleteOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import { DimensionFormModal } from './DimensionFormModal'
import type { CustomDimensionWithStaleness } from '../../types/custom-dimensions'

interface SlotOverviewTabProps {
  workspaceId: string
  dimensions: CustomDimensionWithStaleness[]
}

interface SlotRow {
  slot: number
  slotName: string
  dimension?: CustomDimensionWithStaleness
}

export function SlotOverviewTab({ workspaceId, dimensions }: SlotOverviewTabProps) {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDimension, setEditingDimension] = useState<CustomDimensionWithStaleness | undefined>()

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.customDimensions.delete(workspaceId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customDimensions', workspaceId] })
      message.success('Dimension deleted')
    },
    onError: () => {
      message.error('Failed to delete dimension')
    },
  })

  const backfillMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.customDimensions.backfill(workspaceId, id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customDimensions', workspaceId] })
      message.success(`Backfill complete: ${data.updated.toLocaleString()} sessions updated`)
    },
    onError: () => {
      message.error('Backfill failed')
    },
  })

  const dimensionMap = new Map(dimensions.map((d) => [d.slot, d]))

  const slots: SlotRow[] = Array.from({ length: 10 }, (_, i) => ({
    slot: i + 1,
    slotName: `cd_${i + 1}`,
    dimension: dimensionMap.get(i + 1),
  }))

  const usedSlots = dimensions.map((d) => d.slot)
  const existingCategories = [...new Set(dimensions.map((d) => d.category))]

  const handleCreate = (_slot?: number) => {
    setEditingDimension(undefined)
    setModalOpen(true)
  }

  const handleEdit = (dimension: CustomDimensionWithStaleness) => {
    setEditingDimension(dimension)
    setModalOpen(true)
  }

  const columns = [
    {
      title: 'Slot',
      dataIndex: 'slotName',
      key: 'slot',
      width: 100,
      render: (slotName: string) => <Tag color="purple">{slotName}</Tag>,
    },
    {
      title: 'Display Name',
      key: 'name',
      render: (_: unknown, record: SlotRow) =>
        record.dimension ? (
          <span className="font-medium">{record.dimension.name}</span>
        ) : (
          <span className="text-gray-400">Not configured</span>
        ),
    },
    {
      title: 'Category',
      key: 'category',
      render: (_: unknown, record: SlotRow) =>
        record.dimension ? (
          <Tag>{record.dimension.category}</Tag>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      title: 'Rules',
      key: 'rules',
      render: (_: unknown, record: SlotRow) =>
        record.dimension ? (
          <span>{record.dimension.rules.length} rules</span>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, record: SlotRow) => {
        if (!record.dimension) return <span className="text-gray-400">-</span>
        const d = record.dimension
        if (d.staleSessionCount > 0) {
          const percent = d.totalSessionCount > 0
            ? Math.round((d.staleSessionCount / d.totalSessionCount) * 100)
            : 0
          return (
            <Tag color="orange" icon={<SyncOutlined spin={backfillMutation.isPending} />}>
              {percent}% stale
            </Tag>
          )
        }
        return <Tag color="green">Up to date</Tag>
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_: unknown, record: SlotRow) =>
        record.dimension ? (
          <Space size="small">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record.dimension!)}
            />
            {record.dimension.staleSessionCount > 0 && (
              <Button
                type="text"
                size="small"
                icon={<SyncOutlined />}
                onClick={() => backfillMutation.mutate({ id: record.dimension!.id })}
                loading={backfillMutation.isPending}
                className="!text-orange-500"
              />
            )}
            <Popconfirm
              title="Delete this custom dimension?"
              description="This action cannot be undone."
              onConfirm={() => deleteMutation.mutate({ id: record.dimension!.id })}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Button type="text" size="small" icon={<DeleteOutlined />} danger />
            </Popconfirm>
          </Space>
        ) : (
          <Button
            type="link"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => handleCreate(record.slot)}
          >
            Create
          </Button>
        ),
    },
  ]

  return (
    <div className="p-4">
      <Table
        dataSource={slots}
        columns={columns}
        rowKey="slot"
        pagination={false}
        size="small"
      />
      <DimensionFormModal
        workspaceId={workspaceId}
        dimension={editingDimension}
        usedSlots={usedSlots}
        existingCategories={existingCategories}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}
