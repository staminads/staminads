import { Button, Collapse, Empty, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { api } from '../../lib/api'
import { DimensionCard } from './DimensionCard'
import { DimensionFormModal } from './DimensionFormModal'
import type { CustomDimensionWithStaleness } from '../../types/custom-dimensions'

interface FilterGroupsTabProps {
  workspaceId: string
  dimensions: CustomDimensionWithStaleness[]
}

interface CategoryGroup {
  category: string
  dimensions: CustomDimensionWithStaleness[]
}

export function FilterGroupsTab({ workspaceId, dimensions }: FilterGroupsTabProps) {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDimension, setEditingDimension] = useState<CustomDimensionWithStaleness | undefined>()
  const [backfillingIds, setBackfillingIds] = useState<Set<string>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const groups = useMemo<CategoryGroup[]>(() => {
    const groupMap = new Map<string, CustomDimensionWithStaleness[]>()
    for (const dim of dimensions) {
      const existing = groupMap.get(dim.category) || []
      groupMap.set(dim.category, [...existing, dim])
    }
    return Array.from(groupMap.entries())
      .map(([category, dims]) => ({
        category,
        dimensions: dims.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category))
  }, [dimensions])

  const usedSlots = dimensions.map((d) => d.slot)
  const existingCategories = [...new Set(dimensions.map((d) => d.category))]

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

  const reorderMutation = useMutation({
    mutationFn: api.customDimensions.reorder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customDimensions', workspaceId] })
    },
    onError: () => {
      message.error('Failed to save order')
    },
  })

  const handleBackfill = async (id: string) => {
    setBackfillingIds((prev) => new Set(prev).add(id))
    try {
      const result = await api.customDimensions.backfill(workspaceId, id)
      queryClient.invalidateQueries({ queryKey: ['customDimensions', workspaceId] })
      message.success(`Backfill complete: ${result.updated.toLocaleString()} sessions updated`)
    } catch {
      message.error('Backfill failed')
    } finally {
      setBackfillingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleDragEnd = (category: string) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const group = groups.find((g) => g.category === category)
    if (!group) return

    const oldIndex = group.dimensions.findIndex((d) => d.id === active.id)
    const newIndex = group.dimensions.findIndex((d) => d.id === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(group.dimensions, oldIndex, newIndex)
    reorderMutation.mutate({
      workspace_id: workspaceId,
      dimension_ids: newOrder.map((d) => d.id),
    })
  }

  const handleEdit = (dimension: CustomDimensionWithStaleness) => {
    setEditingDimension(dimension)
    setModalOpen(true)
  }

  const handleCreate = () => {
    setEditingDimension(undefined)
    setModalOpen(true)
  }

  if (dimensions.length === 0) {
    return (
      <div className="p-8">
        <Empty
          description="No custom dimensions configured"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Create Dimension
          </Button>
        </Empty>
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

  const collapseItems = groups.map((group) => ({
    key: group.category,
    label: (
      <div className="flex items-center justify-between">
        <span className="font-medium">{group.category}</span>
        <span className="text-gray-400 text-sm">{group.dimensions.length} dimensions</span>
      </div>
    ),
    children: (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd(group.category)}
      >
        <SortableContext
          items={group.dimensions.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.dimensions.map((dimension) => (
            <DimensionCard
              key={dimension.id}
              dimension={dimension}
              onEdit={() => handleEdit(dimension)}
              onDelete={() => deleteMutation.mutate({ id: dimension.id })}
              onBackfill={() => handleBackfill(dimension.id)}
              isBackfilling={backfillingIds.has(dimension.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    ),
  }))

  return (
    <div className="p-4">
      <div className="mb-4 flex justify-end">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          Add Dimension
        </Button>
      </div>
      <Collapse
        items={collapseItems}
        defaultActiveKey={groups.map((g) => g.category)}
        className="bg-transparent"
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
