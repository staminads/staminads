import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { message } from 'antd'
import { FilterCard } from './FilterCard'
import { api } from '../../lib/api'
import type { FilterWithStaleness } from '../../types/filters'

interface FilterListProps {
  workspaceId: string
  filters: FilterWithStaleness[]
  onEdit: (filter: FilterWithStaleness) => void
}

export function FilterList({ workspaceId, filters, onEdit }: FilterListProps) {
  const queryClient = useQueryClient()

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const reorderMutation = useMutation({
    mutationFn: (filterIds: string[]) =>
      api.filters.reorder({ workspace_id: workspaceId, filter_ids: filterIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
    },
    onError: () => {
      message.error('Failed to reorder filters')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (filterId: string) => api.filters.delete(workspaceId, filterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
      message.success('Filter deleted')
    },
    onError: () => {
      message.error('Failed to delete filter')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; enabled: boolean }) =>
      api.filters.update({ workspace_id: workspaceId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
    },
    onError: () => {
      message.error('Failed to update filter')
    },
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = filters.findIndex((f) => f.id === active.id)
      const newIndex = filters.findIndex((f) => f.id === over.id)
      const reordered = arrayMove(filters, oldIndex, newIndex)
      reorderMutation.mutate(reordered.map((f) => f.id))
    }
  }

  const handleBackfill = (_filterId: string) => {
    // TODO: Implement backfill once the API endpoint is ready
    message.info('Backfill functionality coming soon')
  }

  const handleToggleEnabled = (filter: FilterWithStaleness, enabled: boolean) => {
    updateMutation.mutate({ id: filter.id, enabled })
  }

  const filterIds = filters.map((f) => f.id)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={filterIds} strategy={verticalListSortingStrategy}>
        {filters.map((filter) => (
          <FilterCard
            key={filter.id}
            filter={filter}
            onEdit={() => onEdit(filter)}
            onDelete={() => deleteMutation.mutate(filter.id)}
            onBackfill={() => handleBackfill(filter.id)}
            onToggleEnabled={(enabled) => handleToggleEnabled(filter, enabled)}
            isBackfilling={false}
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}
