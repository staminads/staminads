import { Modal, Form, Input, Button, Tag, Table, Empty, Tooltip } from 'antd'
import { useState } from 'react'
import { SOURCE_FIELDS, WRITABLE_DIMENSIONS } from '../../types/filters'
import type { FilterCondition, FilterOperation, Filter } from '../../types/filters'
import type { CustomDimensionLabels } from '../../types/workspace'
import { evaluateConditions, simulateOperations, testAllFilters } from '../../lib/filter-evaluator'

interface TestFilterModalProps {
  workspaceId: string
  conditions?: FilterCondition[]
  operations?: FilterOperation[]
  filters?: Filter[]
  customDimensionLabels?: CustomDimensionLabels | null
  open: boolean
  onClose: () => void
}

function getDimensionLabel(dimension: string, customLabels?: CustomDimensionLabels | null): string {
  // Check for custom label first (for cd_1, cd_2, etc.)
  if (customLabels && dimension.startsWith('cd_')) {
    const slot = dimension.replace('cd_', '')
    if (customLabels[slot]) {
      return customLabels[slot]
    }
  }
  // Fall back to default label from WRITABLE_DIMENSIONS
  const dimInfo = WRITABLE_DIMENSIONS.find((d) => d.value === dimension)
  return dimInfo?.label || dimension
}

interface SingleResult {
  matches: boolean
  operationResults: Array<{ dimension: string; action: string; resultValue: string | null }>
}

interface MultiResult {
  filter: Filter
  matches: boolean
  operationResults: Array<{ dimension: string; action: string; resultValue: string | null }>
}

export function TestFilterModal({
  workspaceId,
  conditions,
  operations,
  filters,
  customDimensionLabels,
  open,
  onClose,
}: TestFilterModalProps) {
  const [form] = Form.useForm()
  const [singleResult, setSingleResult] = useState<SingleResult | null>(null)
  const [multiResults, setMultiResults] = useState<MultiResult[] | null>(null)

  // Determine mode: single filter test vs all filters test
  const isSingleMode = !!(conditions?.length || operations?.length)

  const handleTest = () => {
    const values = form.getFieldsValue()
    const testValues: Record<string, string | null> = {}

    // Only include fields that have values
    for (const field of SOURCE_FIELDS) {
      const value = values[field.value]
      if (value && value.trim()) {
        testValues[field.value] = value.trim()
      }
    }

    if (isSingleMode) {
      // Test single filter conditions/operations
      const matches = evaluateConditions(conditions || [], testValues)
      const operationResults = simulateOperations(operations || [], matches)
      setSingleResult({ matches, operationResults })
      setMultiResults(null)
    } else if (filters?.length) {
      // Test all filters
      const results = testAllFilters(filters, testValues)
      setMultiResults(results)
      setSingleResult(null)
    }
  }

  const handleClose = () => {
    setSingleResult(null)
    setMultiResults(null)
    form.resetFields()
    onClose()
  }

  const operationColumns = [
    {
      title: 'Dimension',
      dataIndex: 'dimension',
      key: 'dimension',
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
    },
    {
      title: 'Result Value',
      dataIndex: 'resultValue',
      key: 'resultValue',
      render: (value: string | null) => (
        value === null ? <span className="text-gray-400">null</span> : value
      ),
    },
  ]

  const multiResultColumns = [
    {
      title: 'Priority',
      dataIndex: ['filter', 'priority'],
      key: 'priority',
      width: 80,
      render: (priority: number) => (
        <span className="text-gray-600">{priority}</span>
      ),
    },
    {
      title: 'Name',
      dataIndex: ['filter', 'name'],
      key: 'name',
      render: (name: string) => (
        <span className="font-medium">{name}</span>
      ),
    },
    {
      title: 'Conditions',
      key: 'conditions',
      render: (_: unknown, record: MultiResult) => {
        if (record.filter.conditions.length === 0) {
          return <span className="text-gray-400 italic">(always matches)</span>
        }
        const visibleConditions = record.filter.conditions.slice(0, 2)
        const hiddenCount = record.filter.conditions.length - 2
        return (
          <div className="flex flex-col gap-1">
            {visibleConditions.map((c, i) => (
              <div key={i} className="inline-flex items-center gap-1 text-sm">
                <Tag bordered={false} color="green">{c.field}</Tag>
                <Tag bordered={false} color="blue">{c.operator}</Tag>
                <Tag>{c.value}</Tag>
              </div>
            ))}
            {hiddenCount > 0 && (
              <span className="text-gray-400 text-xs">+{hiddenCount} more</span>
            )}
          </div>
        )
      },
    },
    {
      title: 'Operations',
      key: 'operations',
      render: (_: unknown, record: MultiResult) => (
        <div className="flex flex-col gap-1">
          {record.filter.operations.map((op, i) => (
            <div key={i} className="inline-flex items-center gap-1 text-sm">
              <Tooltip title={op.dimension}>
                <Tag bordered={false} color="purple">
                  {getDimensionLabel(op.dimension, customDimensionLabels)}
                </Tag>
              </Tooltip>
              <Tag bordered={false} color="orange">
                {op.action === 'set_value' && '='}
                {op.action === 'unset_value' && '= null'}
                {op.action === 'set_default_value' && '?='}
              </Tag>
              {op.value && <Tag>{op.value}</Tag>}
            </div>
          ))}
        </div>
      ),
    },
  ]

  const matchingFilters = multiResults?.filter((r) => r.matches) || []

  return (
    <Modal
      title={isSingleMode ? 'Test Filter' : 'Test All Filters'}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={900}
    >
      <div className="mt-8">
        {/* Form view */}
        {!singleResult && !multiResults && (
          <div className="space-y-4">
            <Form form={form} layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }}>
              <div className="grid grid-cols-2 gap-x-6">
                {SOURCE_FIELDS.map((field) => (
                  <Form.Item
                    key={field.value}
                    name={field.value}
                    label={
                      <Tooltip title={field.value}>
                        <span>{field.label}</span>
                      </Tooltip>
                    }
                    className="mb-2"
                  >
                    <Input placeholder={field.label} />
                  </Form.Item>
                ))}
              </div>
            </Form>

            <Button
              type="primary"
              onClick={handleTest}
              disabled={!isSingleMode && !filters?.length}
              block
            >
              Run Test
            </Button>
          </div>
        )}

        {/* Single filter result */}
        {singleResult && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-medium">Result:</span>
              {singleResult.matches ? (
                <Tag color="success">Matches</Tag>
              ) : (
                <Tag color="error">No Match</Tag>
              )}
            </div>

            {singleResult.matches && singleResult.operationResults.length > 0 ? (
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">Operation Results:</div>
                <Table
                  dataSource={singleResult.operationResults.map((op, i) => ({ ...op, key: i }))}
                  columns={operationColumns}
                  size="small"
                  pagination={false}
                />
              </div>
            ) : singleResult.matches ? (
              <Empty description="No operations defined" className="mb-4" />
            ) : null}

            <Button onClick={() => setSingleResult(null)} block>
              Back
            </Button>
          </div>
        )}

        {/* Multi filter results */}
        {multiResults && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-medium">Results:</span>
              <span className="text-gray-500">
                {matchingFilters.length} of {multiResults.length} filters match
              </span>
            </div>

            <Table
              dataSource={matchingFilters.map((r, i) => ({ ...r, key: i }))}
              columns={multiResultColumns}
              size="small"
              pagination={false}
              className="mb-4"
            />

            <Button onClick={() => setMultiResults(null)} block>
              Back
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
