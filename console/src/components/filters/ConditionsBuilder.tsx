import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ConditionRow } from './ConditionRow'
import type { FilterCondition, FilterOperator } from '../../types/filters'

interface ConditionsBuilderProps {
  value: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
}

interface SortableConditionRowProps {
  id: string
  index: number
  condition: FilterCondition
  onUpdate: (condition: FilterCondition) => void
  onRemove: () => void
  canRemove: boolean
}

function SortableConditionRow({
  id,
  index,
  condition,
  onUpdate,
  onRemove,
  canRemove,
}: SortableConditionRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <ConditionRow
        index={index}
        value={condition}
        onChange={onUpdate}
        onRemove={onRemove}
        isOnlyCondition={!canRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export function ConditionsBuilder({ value, onChange }: ConditionsBuilderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const conditionIds = value.map((_, i) => `condition-${i}`)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = conditionIds.indexOf(active.id as string)
      const newIndex = conditionIds.indexOf(over.id as string)
      onChange(arrayMove(value, oldIndex, newIndex))
    }
  }

  const updateCondition = (index: number, condition: FilterCondition) => {
    const newConditions = [...value]
    newConditions[index] = condition
    onChange(newConditions)
  }

  const removeCondition = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const addCondition = () => {
    onChange([
      ...value,
      { field: 'utm_source', operator: 'equals' as FilterOperator, value: '' },
    ])
  }

  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">
        All conditions must match (AND logic):
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={conditionIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {value.map((condition, index) => (
              <SortableConditionRow
                key={conditionIds[index]}
                id={conditionIds[index]}
                index={index}
                condition={condition}
                onUpdate={(c) => updateCondition(index, c)}
                onRemove={() => removeCondition(index)}
                canRemove={value.length > 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        type="primary"
        ghost
        block
        icon={<PlusOutlined />}
        onClick={addCondition}
        className="mt-3"
      >
        Add condition
      </Button>
    </div>
  )
}
