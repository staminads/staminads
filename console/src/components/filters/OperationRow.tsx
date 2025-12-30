import { Select, Input, Button } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { FilterOperation, FilterAction } from '../../types/filters'
import { WRITABLE_DIMENSIONS, FILTER_ACTIONS } from '../../types/filters'

interface OperationRowProps {
  index: number
  value: FilterOperation
  onChange: (operation: FilterOperation) => void
  onRemove: () => void
  isOnlyOperation: boolean
}

const groupedDimensions = WRITABLE_DIMENSIONS.reduce(
  (acc, dim) => {
    if (!acc[dim.category]) {
      acc[dim.category] = []
    }
    acc[dim.category].push(dim)
    return acc
  },
  {} as Record<string, typeof WRITABLE_DIMENSIONS[number][]>
)

const dimensionOptions = Object.entries(groupedDimensions).map(([category, dimensions]) => ({
  label: category,
  options: dimensions.map((d) => ({ value: d.value, label: d.label })),
}))

const actionOptions = FILTER_ACTIONS.map((a) => ({
  value: a.value,
  label: a.label,
  description: a.description,
}))

export function OperationRow({ index, value, onChange, onRemove, isOnlyOperation }: OperationRowProps) {
  const showValueInput = value.action === 'set_value' || value.action === 'set_default_value'

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-4">{index + 1}.</span>
      <Select
        value={value.dimension}
        onChange={(dimension) => onChange({ ...value, dimension })}
        options={dimensionOptions}
        placeholder="Select dimension"
        className="w-40"
        showSearch
        optionFilterProp="label"
      />
      <Select
        value={value.action}
        onChange={(action) => onChange({ ...value, action: action as FilterAction })}
        options={actionOptions}
        className="w-[120px]"
        optionRender={(option) => (
          <div>
            <div>{option.label}</div>
            <div className="text-xs text-gray-400">{option.data.description}</div>
          </div>
        )}
      />
      {showValueInput && (
        <Input
          value={value.value || ''}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder="Value"
          className="flex-1 min-w-[200px]"
        />
      )}
      {!showValueInput && <div className="flex-1" />}
      <Button
        type="text"
        icon={<DeleteOutlined />}
        onClick={onRemove}
        disabled={isOnlyOperation}
        danger
      />
    </div>
  )
}
