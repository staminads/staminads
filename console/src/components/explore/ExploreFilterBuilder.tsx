import { useState, useRef } from 'react'
import { Popover, Form, Input, Button, Select, Tooltip, Tag, Space } from 'antd'
import { LeftOutlined, SearchOutlined, PlusCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { analyticsDimensionsQueryOptions } from '../../lib/queries'
import { getDimensionLabel, getDimensionExamples } from '../../lib/explore-utils'
import { DeviceType, BrowserType, OSType, DaysOfWeek } from '../../lib/dictionaries'
import type { Filter, FilterOperator } from '../../types/analytics'
import type { DimensionInfo } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'

const operatorOptions: Record<string, FilterOperator[]> = {
  string: ['equals', 'notEquals', 'contains', 'notContains', 'isEmpty', 'isNotEmpty', 'in', 'notIn'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'],
  boolean: ['equals', 'notEquals'],
}

const operatorsWithoutValue: FilterOperator[] = ['isEmpty', 'isNotEmpty', 'isNull', 'isNotNull']

const operatorLabels: Record<string, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  notContains: 'not contains',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  isNull: 'is null',
  isNotNull: 'is not null',
  in: 'in',
  notIn: 'not in',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
  between: 'between',
}

interface ExploreFilterBuilderProps {
  value: Filter[]
  onChange: (filters: Filter[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
}

interface DimensionWithMeta extends DimensionInfo {
  name: string
}

export function ExploreFilterBuilder({ value, onChange, customDimensionLabels }: ExploreFilterBuilderProps) {
  const [isPopoverVisible, setIsPopoverVisible] = useState(false)
  const [selectedDimension, setSelectedDimension] = useState<DimensionWithMeta | null>(null)
  const [selectedOperator, setSelectedOperator] = useState<FilterOperator>('equals')
  const [searchTerm, setSearchTerm] = useState('')
  const [form] = Form.useForm()
  const popoverRef = useRef<HTMLDivElement>(null)

  const { data: dimensionsData } = useQuery(analyticsDimensionsQueryOptions)

  const dimensions: DimensionWithMeta[] = Object.entries(dimensionsData ?? {}).map(
    ([dimName, dim]) => ({
      ...(dim as DimensionInfo),
      name: dimName,
    }),
  )

  const handleDimensionSelect = (dimension: DimensionWithMeta) => {
    setSelectedDimension(dimension)
    setSelectedOperator('equals')
    form.resetFields()
    form.setFieldsValue({ operator: 'equals' })
    setSearchTerm('')
  }

  const handleOperatorSelect = (operator: FilterOperator) => {
    setSelectedOperator(operator)
    form.setFieldsValue({ operator })
  }

  const handlePrevious = () => {
    setSelectedDimension(null)
    setSelectedOperator('equals')
    form.resetFields()
  }

  const handleApplyFilter = () => {
    form.validateFields().then((values) => {
      const newFilter: Filter = {
        dimension: selectedDimension!.name,
        operator: values.operator,
        values: operatorsWithoutValue.includes(values.operator)
          ? []
          : Array.isArray(values.values)
            ? values.values
            : [values.values],
      }
      const updatedFilters = [...value, newFilter]
      onChange(updatedFilters)
      setIsPopoverVisible(false)
      setSelectedDimension(null)
      setSelectedOperator('equals')
      form.resetFields()
      setSearchTerm('')
    })
  }

  const handleRemoveFilter = (index: number) => {
    const updatedFilters = value.filter((_, i) => i !== index)
    onChange(updatedFilters)
  }

  const handlePopoverVisibleChange = (visible: boolean) => {
    if (!visible && !popoverRef.current?.contains(document.activeElement)) {
      setIsPopoverVisible(visible)
      setSelectedDimension(null)
      setSelectedOperator('equals')
      form.resetFields()
      setSearchTerm('')
    } else {
      setIsPopoverVisible(visible)
    }
  }

  const renderValueInput = () => {
    if (!selectedDimension || operatorsWithoutValue.includes(selectedOperator)) return null

    // Device select
    if (selectedDimension.name === 'device' && ['equals', 'notEquals', 'in', 'notIn'].includes(selectedOperator)) {
      return (
        <Select
          mode={['in', 'notIn'].includes(selectedOperator) ? 'multiple' : undefined}
          placeholder="Select device"
          popupMatchSelectWidth={false}
        >
          {Object.entries(DeviceType).map(([key, label]) => (
            <Select.Option key={key} value={key}>
              {label}
            </Select.Option>
          ))}
        </Select>
      )
    }

    // Browser select
    if (selectedDimension.name === 'browser' && ['equals', 'notEquals', 'in', 'notIn'].includes(selectedOperator)) {
      return (
        <Select
          mode={['in', 'notIn'].includes(selectedOperator) ? 'multiple' : undefined}
          placeholder="Select browser"
          showSearch
          popupMatchSelectWidth={false}
        >
          {BrowserType.map((browser) => (
            <Select.Option key={browser} value={browser}>
              {browser}
            </Select.Option>
          ))}
        </Select>
      )
    }

    // OS select
    if (selectedDimension.name === 'os' && ['equals', 'notEquals', 'in', 'notIn'].includes(selectedOperator)) {
      return (
        <Select
          mode={['in', 'notIn'].includes(selectedOperator) ? 'multiple' : undefined}
          placeholder="Select OS"
          showSearch
          popupMatchSelectWidth={false}
        >
          {OSType.map((os) => (
            <Select.Option key={os} value={os}>
              {os}
            </Select.Option>
          ))}
        </Select>
      )
    }

    // Day of week select
    if (selectedDimension.name === 'day_of_week' && ['equals', 'notEquals'].includes(selectedOperator)) {
      return (
        <Select placeholder="Select day of week">
          {Object.entries(DaysOfWeek).map(([key, day]) => (
            <Select.Option key={key} value={parseInt(key)}>
              {day}
            </Select.Option>
          ))}
        </Select>
      )
    }

    // Boolean select for is_direct, is_weekend
    if (selectedDimension.type === 'boolean') {
      return (
        <Select placeholder="Select value">
          <Select.Option value={1}>True</Select.Option>
          <Select.Option value={0}>False</Select.Option>
        </Select>
      )
    }

    // Number input
    if (selectedDimension.type === 'number') {
      if (selectedOperator === 'between') {
        return (
          <div className="flex gap-2">
            <Form.Item name={['values', 0]} noStyle rules={[{ required: true }]}>
              <Input type="number" placeholder="Min" className="w-1/2" />
            </Form.Item>
            <Form.Item name={['values', 1]} noStyle rules={[{ required: true }]}>
              <Input type="number" placeholder="Max" className="w-1/2" />
            </Form.Item>
          </div>
        )
      }
      return <Input type="number" placeholder="Enter number" />
    }

    // Default text input
    return <Input placeholder="Enter value" />
  }

  const usedDimensions = value.map((filter) => filter.dimension)

  const availableDimensions = dimensions.filter(
    (dimension) => !usedDimensions.includes(dimension.name),
  )

  const filteredDimensions = availableDimensions.filter(
    (dimension) =>
      getDimensionLabel(dimension.name, customDimensionLabels).toLowerCase().includes(searchTerm.toLowerCase()) ||
      dimension.category.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Group filtered dimensions by category
  const filteredByCategory = filteredDimensions.reduce(
    (acc, dim) => {
      const category = dim.category
      if (!acc[category]) acc[category] = []
      acc[category].push(dim)
      return acc
    },
    {} as Record<string, DimensionWithMeta[]>,
  )

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleApplyFilter()
    }
  }

  const getOperatorsForType = (type: string): FilterOperator[] => {
    return operatorOptions[type] || operatorOptions.string
  }

  const popoverContent = (
    <div ref={popoverRef} className="w-72" onKeyPress={handleKeyPress}>
      {selectedDimension ? (
        <>
          <button
            onClick={handlePrevious}
            className="mb-4 flex items-center text-blue-600 hover:text-blue-800 focus:outline-none"
          >
            <LeftOutlined className="mr-1" />
            Back
          </button>
          <div className="text-sm font-medium mb-2">{getDimensionLabel(selectedDimension.name, customDimensionLabels)}</div>
          <Form form={form} layout="vertical" onFinish={handleApplyFilter}>
            <Form.Item name="operator" label="Operator" rules={[{ required: true }]}>
              <div className="flex flex-wrap gap-2">
                {getOperatorsForType(selectedDimension.type).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => handleOperatorSelect(op)}
                    className={`px-2 py-1 text-sm rounded-md ${
                      selectedOperator === op
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {operatorLabels[op] || op}
                  </button>
                ))}
              </div>
            </Form.Item>
            {!operatorsWithoutValue.includes(selectedOperator) && (
              <Form.Item
                name="values"
                label="Value"
                rules={[{ required: true, message: 'Value is required' }]}
              >
                {renderValueInput()}
              </Form.Item>
            )}
            <Form.Item>
              <Button type="primary" block htmlType="submit">
                Apply Filter
              </Button>
            </Form.Item>
          </Form>
        </>
      ) : (
        <>
          <Input
            placeholder="Search dimensions"
            prefix={<SearchOutlined />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-80 overflow-y-auto">
            {Object.entries(filteredByCategory).map(([category, dims]) => (
              <div key={category} className="mb-2">
                <div className="text-[10px] font-semibold text-[var(--primary)] uppercase px-3 py-1">
                  {category === 'Custom' ? 'Custom Dimensions' : category}
                </div>
                {dims.map((dimension) => {
                  const examples = getDimensionExamples(dimension.name)
                  const tooltipContent = (
                    <div className="text-xs">
                      <div className="font-mono text-gray-300">{dimension.name}</div>
                      <div className="text-gray-400">Type: {dimension.type}</div>
                      {examples && (
                        <div className="mt-1 text-gray-400">
                          e.g. {examples[0]}, {examples[1]}
                        </div>
                      )}
                    </div>
                  )
                  return (
                    <Tooltip key={dimension.name} title={tooltipContent} placement="right">
                      <button
                        onClick={() => handleDimensionSelect(dimension)}
                        className="w-full text-left px-3 py-1 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
                      >
                        {getDimensionLabel(dimension.name, customDimensionLabels)}
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
            {Object.keys(filteredByCategory).length === 0 && (
              <div className="text-gray-400 text-sm px-3 py-2">No dimensions found</div>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <span className="flex items-center gap-2">
      <Popover
        content={popoverContent}
        trigger="click"
        open={isPopoverVisible}
        onOpenChange={handlePopoverVisibleChange}
        placement="bottomLeft"
      >
        <Button
          type="link"
          size="small"
          onClick={() => setIsPopoverVisible(true)}
          icon={<PlusCircleOutlined />}
        >
          Add filter
        </Button>
      </Popover>

      {/* Active filter tags */}
      {value.length > 0 && (
        <Space size={[0, 4]} wrap>
          {value.map((filter, index) => (
            <Tag
              key={index}
              color="orange"
              closable
              onClose={() => handleRemoveFilter(index)}
              className="mr-0"
            >
              <span className="font-medium">{getDimensionLabel(filter.dimension, customDimensionLabels)}</span>
              <span className="mx-1">{operatorLabels[filter.operator] || filter.operator}</span>
              {filter.values && filter.values.length > 0 && (
                <span className="font-medium">{filter.values.join(', ')}</span>
              )}
            </Tag>
          ))}
        </Space>
      )}
    </span>
  )
}
