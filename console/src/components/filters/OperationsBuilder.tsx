import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { OperationRow } from './OperationRow'
import type { FilterOperation } from '../../types/filters'

interface OperationsBuilderProps {
  value: FilterOperation[]
  onChange: (operations: FilterOperation[]) => void
}

export function OperationsBuilder({ value, onChange }: OperationsBuilderProps) {
  const updateOperation = (index: number, operation: FilterOperation) => {
    const newOperations = [...value]
    newOperations[index] = operation
    onChange(newOperations)
  }

  const removeOperation = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const addOperation = () => {
    onChange([
      ...value,
      { dimension: 'cd_1', action: 'set_value', value: '' },
    ])
  }

  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">
        When matched, execute these operations:
      </div>
      <div className="space-y-2">
        {value.map((operation, index) => (
          <OperationRow
            key={index}
            index={index}
            value={operation}
            onChange={(op) => updateOperation(index, op)}
            onRemove={() => removeOperation(index)}
            isOnlyOperation={value.length === 1}
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
