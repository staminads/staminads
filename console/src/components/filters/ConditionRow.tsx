import { useRef, useState, useCallback } from 'react'
import { Select, Input, Button, Popconfirm } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { FilterCondition, FilterOperator } from '../../types/filters'
import { SOURCE_FIELDS, OPERATORS, VALUELESS_OPERATORS } from '../../types/filters'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectRef = useRef<any>(null)
  const [isOpen, setIsOpen] = useState(false)
  const hasAutoFocused = useRef(false)

  // Use ref callback to handle autoFocus without useEffect
  const handleSelectRef = useCallback((node: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selectRef.current = node as any
    if (autoFocus && node && !hasAutoFocused.current) {
      hasAutoFocused.current = true
      // Defer focus to next tick to ensure DOM is ready
      setTimeout(() => {
        selectRef.current?.focus()
        setIsOpen(true)
        onFocused?.()
      }, 0)
    }
  }, [autoFocus, onFocused])

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xs text-gray-400 w-4 shrink-0">{index + 1}.</span>
        <Select
          ref={handleSelectRef}
          value={value.field}
          onChange={(field) => onChange({ ...value, field })}
          options={fieldOptions}
          placeholder="Select field"
          className="w-full md:!w-[180px] md:shrink-0"
          showSearch
          optionFilterProp="label"
          open={isOpen}
          onDropdownVisibleChange={setIsOpen}
        />
      </div>
      <Select
        value={value.operator}
        onChange={(operator) => {
          const newOperator = operator as FilterOperator
          // Clear value when switching to a valueless operator
          if (VALUELESS_OPERATORS.includes(newOperator)) {
            onChange({ ...value, operator: newOperator, value: undefined })
          } else {
            onChange({ ...value, operator: newOperator })
          }
        }}
        options={OPERATORS.map((op) => ({ value: op.value, label: op.label }))}
        className="w-full md:!w-[160px] md:shrink-0"
      />
      {!VALUELESS_OPERATORS.includes(value.operator) && (
        <Input
          value={value.value ?? ''}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder={value.operator === 'regex' ? 'Regular expression' : 'Value'}
          className="flex-1 min-w-0"
        />
      )}
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
          className="shrink-0 self-end md:self-auto"
        />
      </Popconfirm>
    </div>
  )
}
