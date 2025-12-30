import { Select, Input, Button } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { CustomDimensionCondition, CustomDimensionOperator } from '../../types/custom-dimensions'
import { SOURCE_FIELDS, OPERATORS } from '../../types/custom-dimensions'

interface ConditionRowProps {
  value: CustomDimensionCondition
  onChange: (condition: CustomDimensionCondition) => void
  onRemove: () => void
  isOnlyCondition: boolean
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

export function ConditionRow({ value, onChange, onRemove, isOnlyCondition }: ConditionRowProps) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={value.field}
        onChange={(field) => onChange({ ...value, field })}
        options={fieldOptions}
        placeholder="Select field"
        className="w-44"
        showSearch
        optionFilterProp="label"
      />
      <Select
        value={value.operator}
        onChange={(operator) => onChange({ ...value, operator: operator as CustomDimensionOperator })}
        options={OPERATORS.map((op) => ({ value: op.value, label: op.label }))}
        className="w-32"
      />
      <Input
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder={value.operator === 'regex' ? 'Regular expression' : 'Value'}
        className="flex-1"
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
