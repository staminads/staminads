import { Drawer, Form, Input, InputNumber, Select, Switch, Button, Space, message } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { ConditionsBuilder } from './ConditionsBuilder'
import { OperationsBuilder } from './OperationsBuilder'
import { TestFilterModal } from './TestFilterModal'
import type {
  FilterWithStaleness,
  FilterCondition,
  FilterOperation,
} from '../../types/filters'
import { SUGGESTED_TAGS } from '../../types/filters'

interface FilterFormModalProps {
  workspaceId: string
  filter?: FilterWithStaleness
  existingTags: string[]
  open: boolean
  onClose: () => void
}

interface FormValues {
  name: string
  priority: number
  tags: string[]
  enabled: boolean
  conditions: FilterCondition[]
  operations: FilterOperation[]
}

export function FilterFormModal({
  workspaceId,
  filter,
  existingTags,
  open,
  onClose,
}: FilterFormModalProps) {
  const [form] = Form.useForm<FormValues>()
  const queryClient = useQueryClient()
  const isEditing = !!filter
  const [testModalOpen, setTestModalOpen] = useState(false)

  const tagOptions = useMemo(() => {
    const allTags = new Set([...existingTags, ...SUGGESTED_TAGS])
    return Array.from(allTags).map((tag) => ({ value: tag, label: tag }))
  }, [existingTags])

  useEffect(() => {
    if (open) {
      if (filter) {
        form.setFieldsValue({
          name: filter.name,
          priority: filter.priority,
          tags: filter.tags,
          enabled: filter.enabled,
          conditions: filter.conditions,
          operations: filter.operations,
        })
      } else {
        form.resetFields()
        form.setFieldsValue({
          priority: 500,
          tags: [],
          enabled: true,
          conditions: [
            { field: 'utm_source', operator: 'equals', value: '' },
          ],
          operations: [
            { dimension: 'cd_1', action: 'set_value', value: '' },
          ],
        })
      }
    }
  }, [open, filter, form])

  const createMutation = useMutation({
    mutationFn: api.filters.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId, 'tags'] })
      message.success('Filter created')
      onClose()
    },
    onError: () => {
      message.error('Failed to create filter')
    },
  })

  const updateMutation = useMutation({
    mutationFn: api.filters.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['filters', workspaceId, 'tags'] })
      message.success('Filter updated')
      onClose()
    },
    onError: () => {
      message.error('Failed to update filter')
    },
  })

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (isEditing && filter) {
        await updateMutation.mutateAsync({
          workspace_id: workspaceId,
          id: filter.id,
          name: values.name,
          priority: values.priority,
          tags: values.tags,
          enabled: values.enabled,
          conditions: values.conditions,
          operations: values.operations,
        })
      } else {
        await createMutation.mutateAsync({
          workspace_id: workspaceId,
          name: values.name,
          priority: values.priority,
          tags: values.tags,
          enabled: values.enabled,
          conditions: values.conditions,
          operations: values.operations,
        })
      }
    } catch {
      // Validation failed
    }
  }

  const handleTest = () => {
    setTestModalOpen(true)
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  const currentConditions = Form.useWatch('conditions', form) || []
  const currentOperations = Form.useWatch('operations', form) || []

  return (
    <>
      <Drawer
        title={isEditing ? 'Edit Filter' : 'Create Filter'}
        open={open}
        onClose={onClose}
        width={640}
        placement="right"
        destroyOnClose
        footer={
          <div className="flex justify-between">
            <Button onClick={handleTest} icon={<ExperimentOutlined />}>
              Test
            </Button>
            <Space>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="primary" onClick={handleSubmit} loading={isPending}>
                {isEditing ? 'Save' : 'Create'}
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-3 gap-4">
            <Form.Item
              name="name"
              label="Name"
              rules={[{ required: true, message: 'Name is required' }]}
              className="col-span-2"
            >
              <Input placeholder="e.g., Set Channel for Google Ads" />
            </Form.Item>

            <Form.Item
              name="priority"
              label="Priority"
              tooltip="Higher priority filters are evaluated first (0-1000)"
              rules={[{ required: true, message: 'Priority is required' }]}
            >
              <InputNumber min={0} max={1000} className="w-full" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Form.Item name="tags" label="Tags" className="col-span-2">
              <Select
                mode="tags"
                options={tagOptions}
                placeholder="Add tags..."
                tokenSeparators={[',']}
              />
            </Form.Item>

            <Form.Item name="enabled" label="Enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>

          <Form.Item
            name="conditions"
            label="Conditions"
            rules={[
              { required: true, message: 'At least one condition is required' },
              {
                validator: (_, conditions: FilterCondition[]) => {
                  if (!conditions || conditions.length === 0) {
                    return Promise.reject('At least one condition is required')
                  }
                  for (const condition of conditions) {
                    if (!condition.value?.trim()) {
                      return Promise.reject('All conditions must have a value')
                    }
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <ConditionsBuilder
              value={form.getFieldValue('conditions') || []}
              onChange={(conditions) => form.setFieldValue('conditions', conditions)}
            />
          </Form.Item>

          <Form.Item
            name="operations"
            label="Operations"
            rules={[
              { required: true, message: 'At least one operation is required' },
              {
                validator: (_, operations: FilterOperation[]) => {
                  if (!operations || operations.length === 0) {
                    return Promise.reject('At least one operation is required')
                  }
                  for (const op of operations) {
                    if ((op.action === 'set_value' || op.action === 'set_default_value') && !op.value?.trim()) {
                      return Promise.reject(`Value is required for ${op.action} action`)
                    }
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <OperationsBuilder
              value={form.getFieldValue('operations') || []}
              onChange={(operations) => form.setFieldValue('operations', operations)}
            />
          </Form.Item>
        </Form>
      </Drawer>

      <TestFilterModal
        workspaceId={workspaceId}
        conditions={currentConditions}
        operations={currentOperations}
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
      />
    </>
  )
}
