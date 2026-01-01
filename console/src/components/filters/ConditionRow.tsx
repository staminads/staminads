import { useEffect, useRef, useState } from 'react'
import { Select, Input, Button, Popconfirm } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { FilterCondition, FilterOperator } from '../../types/filters'
import { SOURCE_FIELDS, OPERATORS } from '../../types/filters'
import type { BaseSelectRef } from 'rc-select'

interface ConditionRowProps {
  index: number
  value: FilterCondition
  onChange: (condition: FilterCondition) => void
  onRemove: () => void
  isOnlyCondition: boolean
  autoFocus?: boolean
  onFocused?: () => void
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

export function ConditionRow({ index, value, onChange, onRemove, isOnlyCondition, autoFocus, onFocused }: ConditionRowProps) {
  const selectRef = useRef<BaseSelectRef>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (autoFocus && selectRef.current) {
      selectRef.current.focus()
      setIsOpen(true)
      onFocused?.()
    }
  }, [autoFocus, onFocused])

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-4 shrink-0">{index + 1}.</span>
      <Select
        ref={selectRef}
        value={value.field}
        onChange={(field) => onChange({ ...value, field })}
        options={fieldOptions}
        placeholder="Select field"
        style={{ width: 180, flexShrink: 0 }}
        showSearch
        optionFilterProp="label"
        open={isOpen}
        onDropdownVisibleChange={setIsOpen}
      />
      <Select
        value={value.operator}
        onChange={(operator) => onChange({ ...value, operator: operator as FilterOperator })}
        options={OPERATORS.map((op) => ({ value: op.value, label: op.label }))}
        style={{ width: 160, flexShrink: 0 }}
      />
      <Input
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder={value.operator === 'regex' ? 'Regular expression' : 'Value'}
        style={{ flex: 1, minWidth: 0 }}
      />
      <Popconfirm
        title="Delete this condition?"
        onConfirm={onRemove}
        okText="Delete"
        cancelText="Cancel"
        disabled={isOnlyCondition}
      >
        <Button
          type="text"
          icon={<DeleteOutlined />}
          disabled={isOnlyCondition}
          className="shrink-0"
        />
      </Popconfirm>
    </div>
  )
}
