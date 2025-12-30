import { Select, Input, Button } from 'antd'
import { DeleteOutlined, HolderOutlined } from '@ant-design/icons'
import type { FilterCondition, FilterOperator } from '../../types/filters'
import { SOURCE_FIELDS, OPERATORS } from '../../types/filters'

interface ConditionRowProps {
  index: number
  value: FilterCondition
  onChange: (condition: FilterCondition) => void
  onRemove: () => void
  isOnlyCondition: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>
}

const groupedFields = SOURCE_FIELDS.reduce(
  (acc, field) => {
    if (!acc[field.category]) {
      acc[field.category] = []
    }
    acc[field.category].push(field)
    return acc
  },
  {} as Record<string, typeof SOURCE_FIELDS[number][]>
)

const fieldOptions = Object.entries(groupedFields).map(([category, fields]) => ({
  label: category,
  options: fields.map((f) => ({ value: f.value, label: f.label })),
}))

export function ConditionRow({ index, value, onChange, onRemove, isOnlyCondition, dragHandleProps }: ConditionRowProps) {
  return (
    <div className="flex items-center gap-2">
      {dragHandleProps && (
        <span {...dragHandleProps} className="cursor-grab">
          <HolderOutlined className="text-gray-400" />
        </span>
      )}
      <span className="text-xs text-gray-400 w-4">{index + 1}.</span>
      <Select
        value={value.field}
        onChange={(field) => onChange({ ...value, field })}
        options={fieldOptions}
        placeholder="Select field"
        className="w-40"
        showSearch
        optionFilterProp="label"
      />
      <Select
        value={value.operator}
        onChange={(operator) => onChange({ ...value, operator: operator as FilterOperator })}
        options={OPERATORS.map((op) => ({ value: op.value, label: op.label }))}
        className="w-[100px]"
      />
      <Input
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder={value.operator === 'regex' ? 'Regular expression' : 'Value'}
        className="flex-1 min-w-[200px]"
      />
      <Button
        type="text"
        icon={<DeleteOutlined />}
        onClick={onRemove}
        disabled={isOnlyCondition}
        danger
      />
    </div>
  )
}
