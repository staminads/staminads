import { Modal, Form, Input, Select, Button, Tag, Table, Empty } from 'antd'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import { SOURCE_FIELDS } from '../../types/filters'
import type { FilterCondition, FilterOperation, TestFilterResult } from '../../types/filters'

interface TestFilterModalProps {
  workspaceId: string
  conditions: FilterCondition[]
  operations: FilterOperation[]
  open: boolean
  onClose: () => void
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

export function TestFilterModal({
  workspaceId,
  conditions,
  operations,
  open,
  onClose,
}: TestFilterModalProps) {
  const [form] = Form.useForm()
  const [result, setResult] = useState<TestFilterResult | null>(null)
  const [selectedFields, setSelectedFields] = useState<string[]>([])

  const testMutation = useMutation({
    mutationFn: api.filters.test,
    onSuccess: (data) => {
      setResult(data)
    },
  })

  const handleTest = async () => {
    const values = form.getFieldsValue()
    const testValues: Record<string, string | null> = {}

    for (const field of selectedFields) {
      testValues[field] = values[field] || null
    }

    await testMutation.mutateAsync({
      workspace_id: workspaceId,
      conditions,
      operations,
      testValues,
    })
  }

  const handleClose = () => {
    setResult(null)
    setSelectedFields([])
    form.resetFields()
    onClose()
  }

  const handleFieldsChange = (fields: string[]) => {
    setSelectedFields(fields)
    setResult(null)
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

  return (
    <Modal
      title="Test Filter"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={560}
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs text-gray-500 mb-2">Select fields to test:</div>
          <Select
            mode="multiple"
            value={selectedFields}
            onChange={handleFieldsChange}
            options={fieldOptions}
            placeholder="Select fields..."
            className="w-full"
            optionFilterProp="label"
          />
        </div>

        {selectedFields.length > 0 && (
          <Form form={form} layout="vertical" size="small">
            {selectedFields.map((field) => {
              const fieldInfo = SOURCE_FIELDS.find((f) => f.value === field)
              return (
                <Form.Item
                  key={field}
                  name={field}
                  label={fieldInfo?.label || field}
                >
                  <Input placeholder={`Enter ${fieldInfo?.label || field} value`} />
                </Form.Item>
              )
            })}
          </Form>
        )}

        <Button
          type="primary"
          onClick={handleTest}
          loading={testMutation.isPending}
          disabled={selectedFields.length === 0 || conditions.length === 0 || operations.length === 0}
          block
        >
          Run Test
        </Button>

        {(conditions.length === 0 || operations.length === 0) && (
          <div className="text-xs text-orange-500 mt-2">
            Add conditions and operations before testing.
          </div>
        )}

        {result && (
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-medium">Result:</span>
              {result.matches ? (
                <Tag color="success">Matches</Tag>
              ) : (
                <Tag color="error">No Match</Tag>
              )}
            </div>

            {result.matches && result.operationResults.length > 0 ? (
              <div>
                <div className="text-xs text-gray-500 mb-2">Operation Results:</div>
                <Table
                  dataSource={result.operationResults.map((op, i) => ({ ...op, key: i }))}
                  columns={operationColumns}
                  size="small"
                  pagination={false}
                />
              </div>
            ) : result.matches ? (
              <Empty description="No operations defined" />
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  )
}
