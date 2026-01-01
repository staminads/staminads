import { useState } from 'react'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { OperationRow } from './OperationRow'
import type { FilterOperation } from '../../types/filters'
import type { CustomDimensionLabels } from '../../types/workspace'

interface OperationsBuilderProps {
  value: FilterOperation[]
  onChange: (operations: FilterOperation[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
}

export function OperationsBuilder({ value, onChange, customDimensionLabels }: OperationsBuilderProps) {
  const operations = value || []
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  const updateOperation = (index: number, operation: FilterOperation) => {
    const newOperations = [...operations]
    newOperations[index] = operation
    onChange(newOperations)
  }

  const removeOperation = (index: number) => {
    onChange(operations.filter((_, i) => i !== index))
  }

  const addOperation = () => {
    const newIndex = operations.length
    onChange([
      ...operations,
      { dimension: 'channel', action: 'set_value', value: '' },
    ])
    setFocusIndex(newIndex)
  }

  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">
        When matched, execute these operations:
      </div>
      <div className="space-y-2">
        {operations.map((operation, index) => (
          <OperationRow
            key={index}
            index={index}
            value={operation}
            onChange={(op) => updateOperation(index, op)}
            onRemove={() => removeOperation(index)}
            isOnlyOperation={operations.length === 1}
            customDimensionLabels={customDimensionLabels}
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
        onClick={addOperation}
        className="mt-3"
      >
        Add operation
      </Button>
    </div>
  )
}
