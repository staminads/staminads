import { Button, Card, Input, Space } from 'antd'
import { PlusOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons'
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
import type { CustomDimensionRule, CustomDimensionCondition } from '../../types/custom-dimensions'

interface RuleBuilderProps {
  value: CustomDimensionRule[]
  onChange: (rules: CustomDimensionRule[]) => void
}

interface SortableRuleProps {
  id: string
  index: number
  rule: CustomDimensionRule
  onUpdate: (rule: CustomDimensionRule) => void
  onRemove: () => void
  canRemove: boolean
}

function SortableRule({ id, index, rule, onUpdate, onRemove, canRemove }: SortableRuleProps) {
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

  const updateCondition = (conditionIndex: number, condition: CustomDimensionCondition) => {
    const newConditions = [...rule.conditions]
    newConditions[conditionIndex] = condition
    onUpdate({ ...rule, conditions: newConditions })
  }

  const removeCondition = (conditionIndex: number) => {
    const newConditions = rule.conditions.filter((_, i) => i !== conditionIndex)
    onUpdate({ ...rule, conditions: newConditions })
  }

  const addCondition = () => {
    onUpdate({
      ...rule,
      conditions: [...rule.conditions, { field: 'utm_source', operator: 'equals', value: '' }],
    })
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        size="small"
        className="mb-2"
        title={
          <div className="flex items-center gap-2">
            <span {...attributes} {...listeners} className="cursor-grab">
              <HolderOutlined className="text-gray-400" />
            </span>
            <span className="text-sm font-normal text-gray-500">Rule {index + 1}</span>
          </div>
        }
        extra={
          <Button
            type="text"
            icon={<DeleteOutlined />}
            onClick={onRemove}
            disabled={!canRemove}
            danger
            size="small"
          />
        }
      >
        <div className="space-y-2">
          <div className="text-xs text-gray-500 mb-2">
            When ALL conditions match:
          </div>
          {rule.conditions.map((condition, condIdx) => (
            <ConditionRow
              key={condIdx}
              value={condition}
              onChange={(c) => updateCondition(condIdx, c)}
              onRemove={() => removeCondition(condIdx)}
              isOnlyCondition={rule.conditions.length === 1}
            />
          ))}
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={addCondition}
            className="mt-2"
          >
            Add condition
          </Button>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <Space className="w-full">
              <span className="text-sm text-gray-600">Then set value to:</span>
              <Input
                value={rule.outputValue}
                onChange={(e) => onUpdate({ ...rule, outputValue: e.target.value })}
                placeholder="Output value"
                className="flex-1"
                style={{ width: 200 }}
              />
            </Space>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function RuleBuilder({ value, onChange }: RuleBuilderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const ruleIds = value.map((_, i) => `rule-${i}`)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = ruleIds.indexOf(active.id as string)
      const newIndex = ruleIds.indexOf(over.id as string)
      onChange(arrayMove(value, oldIndex, newIndex))
    }
  }

  const updateRule = (index: number, rule: CustomDimensionRule) => {
    const newRules = [...value]
    newRules[index] = rule
    onChange(newRules)
  }

  const removeRule = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const addRule = () => {
    onChange([
      ...value,
      {
        conditions: [{ field: 'utm_source', operator: 'equals', value: '' }],
        outputValue: '',
      },
    ])
  }

  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">
        Rules are evaluated in order. First matching rule wins.
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ruleIds} strategy={verticalListSortingStrategy}>
          {value.map((rule, index) => (
            <SortableRule
              key={ruleIds[index]}
              id={ruleIds[index]}
              index={index}
              rule={rule}
              onUpdate={(r) => updateRule(index, r)}
              onRemove={() => removeRule(index)}
              canRemove={value.length > 1}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button type="dashed" icon={<PlusOutlined />} onClick={addRule} block>
        Add rule
      </Button>
    </div>
  )
}
