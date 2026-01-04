import { useRef, useState, useCallback } from 'react'
import { Select, Input, Button, Popconfirm } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { FilterOperation, FilterAction } from '../../types/filters'
import { WRITABLE_DIMENSIONS, FILTER_ACTIONS } from '../../types/filters'
import type { CustomDimensionLabels } from '../../types/workspace'

interface OperationRowProps {
  index: number
  value: FilterOperation
  onChange: (operation: FilterOperation) => void
  onRemove: () => void
  isOnlyOperation: boolean
  customDimensionLabels?: CustomDimensionLabels | null
  autoFocus?: boolean
  onFocused?: () => void
}

const actionOptions = FILTER_ACTIONS.map((a) => ({
  value: a.value,
  label: a.label,
  description: a.description,
}))

function getDimensionOptions(customLabels?: CustomDimensionLabels | null) {
  // Create a map of custom labels with cd_ prefix
  const labelMap: Record<string, string> = {}
  if (customLabels) {
    for (const [slot, label] of Object.entries(customLabels)) {
      labelMap[`cd_${slot}`] = label
    }
  }

  // Group dimensions with custom labels applied
  const grouped = WRITABLE_DIMENSIONS.reduce(
    (acc, dim) => {
      if (!acc[dim.category]) {
        acc[dim.category] = []
      }
      // Use custom label if available, otherwise use default
      const label = labelMap[dim.value] || dim.label
      acc[dim.category].push({ value: dim.value, label })
      return acc
    },
    {} as Record<string, { value: string; label: string }[]>
  )

  return Object.entries(grouped).map(([category, dimensions]) => ({
    label: category,
    options: dimensions,
  }))
}

export function OperationRow({ index, value, onChange, onRemove, isOnlyOperation, customDimensionLabels, autoFocus, onFocused }: OperationRowProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectRef = useRef<any>(null)
  const [isOpen, setIsOpen] = useState(false)
  const hasAutoFocused = useRef(false)
  const showValueInput = value.action === 'set_value' || value.action === 'set_default_value'
  const dimensionOptions = getDimensionOptions(customDimensionLabels)

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
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-4 shrink-0">{index + 1}.</span>
      <Select
        ref={handleSelectRef}
        value={value.dimension}
        onChange={(dimension) => onChange({ ...value, dimension })}
        options={dimensionOptions}
        placeholder="Select dimension"
        style={{ width: 180, flexShrink: 0 }}
        showSearch
        optionFilterProp="label"
        open={isOpen}
        onDropdownVisibleChange={setIsOpen}
      />
      <Select
        value={value.action}
        onChange={(action) => onChange({
          ...value,
          action: action as FilterAction,
          value: action === 'unset_value' ? '' : value.value,
        })}
        options={actionOptions}
        style={{ width: 160, flexShrink: 0 }}
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
          style={{ flex: 1, minWidth: 0 }}
        />
      )}
      {!showValueInput && <div style={{ flex: 1 }} />}
      <Popconfirm
        title="Delete this operation?"
        onConfirm={onRemove}
        okText="Delete"
        cancelText="Cancel"
        disabled={isOnlyOperation}
      >
        <Button
          type="text"
          icon={<DeleteOutlined />}
          disabled={isOnlyOperation}
          className="shrink-0"
        />
      </Popconfirm>
    </div>
  )
}
