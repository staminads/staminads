import { useState } from 'react'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { ConditionRow } from './ConditionRow'
import type { FilterCondition, FilterOperator } from '../../types/filters'

interface ConditionsBuilderProps {
  value: FilterCondition[]
  onChange: (conditions: FilterCondition[]) => void
}

export function ConditionsBuilder({ value, onChange }: ConditionsBuilderProps) {
  const conditions = value || []
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  const updateCondition = (index: number, condition: FilterCondition) => {
    const newConditions = [...conditions]
    newConditions[index] = condition
    onChange(newConditions)
  }

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index))
  }

  const addCondition = () => {
    const newIndex = conditions.length
    onChange([
      ...conditions,
      { field: 'utm_source', operator: 'equals' as FilterOperator, value: '' },
    ])
    setFocusIndex(newIndex)
  }

  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">
        All conditions must match (AND logic):
      </div>
      <div className="space-y-2">
        {conditions.map((condition, index) => (
          <ConditionRow
            key={index}
            index={index}
            value={condition}
            onChange={(c) => updateCondition(index, c)}
            onRemove={() => removeCondition(index)}
            isOnlyCondition={conditions.length === 1}
            autoFocus={focusIndex === index}
            onFocused={() => setFocusIndex(null)}
          />
        ))}
      </div>
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
