import { useState, useRef } from 'react'
import { Popover, Form, Input, InputNumber, Button, Select, Tooltip, Tag, Space } from 'antd'
import { LeftOutlined, SearchOutlined, PlusCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { analyticsDimensionsQueryOptions } from '../../lib/queries'
import { getDimensionLabel, getDimensionExamples } from '../../lib/explore-utils'
import { DeviceType, BrowserType, OSType, DaysOfWeek } from '../../lib/dictionaries'
import type { Filter, FilterOperator, MetricFilter, MetricFilterOperator } from '../../types/analytics'
import type { DimensionInfo } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'

// Hardcoded list of metrics that can be filtered
const FILTERABLE_METRICS = [
  { name: 'bounce_rate', label: 'Bounce Rate', unit: '%' },
  { name: 'median_duration', label: 'Median Duration', unit: '' },
  { name: 'median_scroll', label: 'Median Scroll', unit: '%' },
] as const

type FilterableMetric = (typeof FILTERABLE_METRICS)[number]

// Format duration in seconds to human-readable "Xm Ys" format
const formatDurationValue = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins === 0) return `${secs}s`
  if (secs === 0) return `${mins}m`
  return `${mins}m ${secs}s`
}

// Custom duration input with minutes and seconds side by side
interface DurationInputProps {
  value?: number
  onChange?: (value: number) => void
}

const DurationInput: React.FC<DurationInputProps> = ({ value, onChange }) => {
  const mins = value !== undefined ? Math.floor(value / 60) : undefined
  const secs = value !== undefined ? Math.round(value % 60) : undefined

  const handleChange = (newMins: number | null, newSecs: number | null) => {
    const m = newMins ?? 0
    const s = newSecs ?? 0
    onChange?.(m * 60 + s)
  }

  return (
    <Space.Compact style={{ width: '100%' }}>
      <InputNumber
        min={0}
        placeholder="0"
        value={mins}
        onChange={(m) => handleChange(m, secs ?? 0)}
        addonAfter="min"
        style={{ width: '50%' }}
      />
      <InputNumber
        min={0}
        max={59}
        placeholder="0"
        value={secs}
        onChange={(s) => handleChange(mins ?? 0, s)}
        addonAfter="sec"
        style={{ width: '50%' }}
      />
    </Space.Compact>
  )
}

const METRIC_OPERATORS: MetricFilterOperator[] = ['gt', 'gte', 'lt', 'lte', 'between']

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
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  between: 'between',
}

interface ExploreFilterBuilderProps {
  value: Filter[]
  onChange: (filters: Filter[]) => void
  metricFilters?: MetricFilter[]
  onMetricFiltersChange?: (metricFilters: MetricFilter[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
}

interface DimensionWithMeta extends DimensionInfo {
  name: string
}

export function ExploreFilterBuilder({ value, onChange, metricFilters = [], onMetricFiltersChange, customDimensionLabels }: ExploreFilterBuilderProps) {
  // Whether metric filters are enabled (if callback is provided)
  const metricFiltersEnabled = !!onMetricFiltersChange
  const [isPopoverVisible, setIsPopoverVisible] = useState(false)
  const [selectedType, setSelectedType] = useState<'dimension' | 'metric' | null>(null)
  const [selectedDimension, setSelectedDimension] = useState<DimensionWithMeta | null>(null)
  const [selectedMetric, setSelectedMetric] = useState<FilterableMetric | null>(null)
  const [selectedOperator, setSelectedOperator] = useState<FilterOperator | MetricFilterOperator>('equals')
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
    setSelectedType('dimension')
    setSelectedDimension(dimension)
    setSelectedMetric(null)
    setSelectedOperator('equals')
    form.resetFields()
    form.setFieldsValue({ operator: 'equals' })
    setSearchTerm('')
  }

  const handleMetricSelect = (metric: FilterableMetric) => {
    setSelectedType('metric')
    setSelectedMetric(metric)
    setSelectedDimension(null)
    setSelectedOperator('gt')
    form.resetFields()
    form.setFieldsValue({ operator: 'gt' })
    setSearchTerm('')
  }

  const handleOperatorSelect = (operator: FilterOperator | MetricFilterOperator) => {
    setSelectedOperator(operator)
    form.setFieldsValue({ operator })
  }

  const handlePrevious = () => {
    setSelectedType(null)
    setSelectedDimension(null)
    setSelectedMetric(null)
    setSelectedOperator('equals')
    form.resetFields()
  }

  const handleApplyFilter = () => {
    form.validateFields().then((values) => {
      if (selectedType === 'dimension' && selectedDimension) {
        const newFilter: Filter = {
          dimension: selectedDimension.name,
          operator: values.operator,
          values: operatorsWithoutValue.includes(values.operator)
            ? []
            : Array.isArray(values.values)
              ? values.values
              : [values.values],
        }
        onChange([...value, newFilter])
      } else if (selectedType === 'metric' && selectedMetric && onMetricFiltersChange) {
        const newFilter: MetricFilter = {
          metric: selectedMetric.name,
          operator: values.operator as MetricFilterOperator,
          values: values.operator === 'between'
            ? [Number(values.values[0]), Number(values.values[1])]
            : [Number(values.values)],
        }
        onMetricFiltersChange([...metricFilters, newFilter])
      }
      setIsPopoverVisible(false)
      setSelectedType(null)
      setSelectedDimension(null)
      setSelectedMetric(null)
      setSelectedOperator('equals')
      form.resetFields()
      setSearchTerm('')
    })
  }

  const handleRemoveFilter = (index: number) => {
    const updatedFilters = value.filter((_, i) => i !== index)
    onChange(updatedFilters)
  }

  const handleRemoveMetricFilter = (index: number) => {
    if (!onMetricFiltersChange) return
    const updatedFilters = metricFilters.filter((_, i) => i !== index)
    onMetricFiltersChange(updatedFilters)
  }

  const handlePopoverVisibleChange = (visible: boolean) => {
    if (!visible && !popoverRef.current?.contains(document.activeElement)) {
      setIsPopoverVisible(visible)
      setSelectedType(null)
      setSelectedDimension(null)
      setSelectedMetric(null)
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
  const usedMetrics = metricFilters.map((filter) => filter.metric)

  const availableDimensions = dimensions.filter(
    (dimension) => !usedDimensions.includes(dimension.name),
  )

  const availableMetrics = FILTERABLE_METRICS.filter(
    (metric) => !usedMetrics.includes(metric.name),
  )

  const filteredDimensions = availableDimensions.filter(
    (dimension) =>
      getDimensionLabel(dimension.name, customDimensionLabels).toLowerCase().includes(searchTerm.toLowerCase()) ||
      dimension.category.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const filteredMetrics = availableMetrics.filter(
    (metric) =>
      metric.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      metric.name.toLowerCase().includes(searchTerm.toLowerCase()),
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

  const renderMetricValueInput = () => {
    if (!selectedMetric) return null

    // Special handling for duration metrics
    if (selectedMetric.name === 'median_duration') {
      if (selectedOperator === 'between') {
        return (
          <div className="flex flex-col gap-2">
            <div>
              <span className="text-xs text-gray-500">Min:</span>
              <Form.Item name={['values', 0]} noStyle rules={[{ required: true }]}>
                <DurationInput />
              </Form.Item>
            </div>
            <div>
              <span className="text-xs text-gray-500">Max:</span>
              <Form.Item name={['values', 1]} noStyle rules={[{ required: true }]}>
                <DurationInput />
              </Form.Item>
            </div>
          </div>
        )
      }
      return (
        <Form.Item name="values" noStyle rules={[{ required: true }]}>
          <DurationInput />
        </Form.Item>
      )
    }

    // Default numeric input for other metrics (bounce_rate, median_scroll)
    if (selectedOperator === 'between') {
      return (
        <div className="flex gap-2">
          <Form.Item name={['values', 0]} noStyle rules={[{ required: true }]}>
            <Input type="number" placeholder="Min" className="w-1/2" suffix={selectedMetric.unit} />
          </Form.Item>
          <Form.Item name={['values', 1]} noStyle rules={[{ required: true }]}>
            <Input type="number" placeholder="Max" className="w-1/2" suffix={selectedMetric.unit} />
          </Form.Item>
        </div>
      )
    }
    return <Input type="number" placeholder="Enter value" suffix={selectedMetric.unit} />
  }

  const popoverContent = (
    <div ref={popoverRef} className="w-72" onKeyPress={handleKeyPress}>
      {selectedType === 'dimension' && selectedDimension ? (
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
            {!operatorsWithoutValue.includes(selectedOperator as FilterOperator) && (
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
      ) : selectedType === 'metric' && selectedMetric ? (
        <>
          <button
            onClick={handlePrevious}
            className="mb-4 flex items-center text-blue-600 hover:text-blue-800 focus:outline-none"
          >
            <LeftOutlined className="mr-1" />
            Back
          </button>
          <div className="text-sm font-medium mb-2">{selectedMetric.label}</div>
          <Form form={form} layout="vertical" onFinish={handleApplyFilter}>
            <Form.Item name="operator" label="Operator" rules={[{ required: true }]}>
              <div className="flex flex-wrap gap-2">
                {METRIC_OPERATORS.map((op) => (
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
            <Form.Item
              name="values"
              label="Value"
              rules={[{ required: true, message: 'Value is required' }]}
            >
              {renderMetricValueInput()}
            </Form.Item>
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
            placeholder="Search"
            prefix={<SearchOutlined />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-80 overflow-y-auto">
            {/* Dimensions grouped by category */}
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

            {/* Metrics section - only show if metric filters are enabled */}
            {metricFiltersEnabled && filteredMetrics.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] font-semibold text-[var(--primary)] uppercase px-3 py-1">
                  Metrics
                </div>
                {filteredMetrics.map((metric) => (
                  <Tooltip
                    key={metric.name}
                    title={<div className="text-xs font-mono text-gray-300">{metric.name}</div>}
                    placement="right"
                  >
                    <button
                      onClick={() => handleMetricSelect(metric)}
                      className="w-full text-left px-3 py-1 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
                    >
                      {metric.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}

            {Object.keys(filteredByCategory).length === 0 && (!metricFiltersEnabled || filteredMetrics.length === 0) && (
              <div className="text-gray-400 text-sm px-3 py-2">No results found</div>
            )}
          </div>
        </>
      )}
    </div>
  )

  // Helper to get metric label by name
  const getMetricLabel = (metricName: string): string => {
    const metric = FILTERABLE_METRICS.find((m) => m.name === metricName)
    return metric?.label ?? metricName
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
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
      {(value.length > 0 || metricFilters.length > 0) && (
        <Space size={[8, 4]} wrap>
          {/* Dimension filters - orange */}
          {value.map((filter, index) => (
            <Tag
              key={`dim-${index}`}
              color="orange"
              closable
              onClose={(e) => {
                e.preventDefault()
                handleRemoveFilter(index)
              }}
              className="mr-0"
            >
              <span className="font-medium">{getDimensionLabel(filter.dimension, customDimensionLabels)}</span>
              <span className="mx-1">{operatorLabels[filter.operator] || filter.operator}</span>
              {filter.values && filter.values.length > 0 && (
                <span className="font-medium">{filter.values.join(', ')}</span>
              )}
            </Tag>
          ))}
          {/* Metric filters - gold */}
          {metricFilters.map((filter, index) => {
            const metric = FILTERABLE_METRICS.find((m) => m.name === filter.metric)
            const formatValue = (val: number | null) => {
              if (val === null) return ''
              return filter.metric === 'median_duration'
                ? formatDurationValue(val)
                : `${val}${metric?.unit || ''}`
            }
            return (
              <Tag
                key={`metric-${index}`}
                color="gold"
                closable
                onClose={(e) => {
                  e.preventDefault()
                  handleRemoveMetricFilter(index)
                }}
                className="mr-0"
              >
                <span className="font-medium">{getMetricLabel(filter.metric)}</span>
                <span className="mx-1">{operatorLabels[filter.operator] || filter.operator}</span>
                <span className="font-medium">
                  {filter.operator === 'between'
                    ? `${formatValue(filter.values[0])} - ${formatValue(filter.values[1])}`
                    : formatValue(filter.values[0])}
                </span>
              </Tag>
            )
          })}
        </Space>
      )}
    </span>
  )
}
