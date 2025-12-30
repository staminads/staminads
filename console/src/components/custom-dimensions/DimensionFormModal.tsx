import { Modal, Form, Input, Select, AutoComplete, message } from 'antd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api } from '../../lib/api'
import { RuleBuilder } from './RuleBuilder'
import type {
  CustomDimensionWithStaleness,
  CustomDimensionRule,
} from '../../types/custom-dimensions'

interface DimensionFormModalProps {
  workspaceId: string
  dimension?: CustomDimensionWithStaleness
  usedSlots: number[]
  existingCategories: string[]
  open: boolean
  onClose: () => void
}

interface FormValues {
  name: string
  category: string
  slot?: number
  defaultValue?: string
  rules: CustomDimensionRule[]
}

const SLOT_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: i + 1,
  label: `cd_${i + 1}`,
}))

export function DimensionFormModal({
  workspaceId,
  dimension,
  usedSlots,
  existingCategories,
  open,
  onClose,
}: DimensionFormModalProps) {
  const [form] = Form.useForm<FormValues>()
  const queryClient = useQueryClient()
  const isEditing = !!dimension

  const availableSlots = useMemo(() => {
    if (isEditing) {
      return SLOT_OPTIONS
    }
    return SLOT_OPTIONS.map((opt) => ({
      ...opt,
      disabled: usedSlots.includes(opt.value),
    }))
  }, [usedSlots, isEditing])

  const categoryOptions = useMemo(
    () => existingCategories.map((c) => ({ value: c })),
    [existingCategories]
  )

  useEffect(() => {
    if (open) {
      if (dimension) {
        form.setFieldsValue({
          name: dimension.name,
          category: dimension.category,
          slot: dimension.slot,
          defaultValue: dimension.defaultValue,
          rules: dimension.rules,
        })
      } else {
        form.resetFields()
        form.setFieldsValue({
          category: 'Custom',
          rules: [
            {
              conditions: [{ field: 'utm_source', operator: 'equals', value: '' }],
              outputValue: '',
            },
          ],
        })
      }
    }
  }, [open, dimension, form])

  const createMutation = useMutation({
    mutationFn: api.customDimensions.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customDimensions', workspaceId] })
      message.success('Dimension created')
      onClose()
    },
    onError: () => {
      message.error('Failed to create dimension')
    },
  })

  const updateMutation = useMutation({
    mutationFn: api.customDimensions.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customDimensions', workspaceId] })
      message.success('Dimension updated')
      onClose()
    },
    onError: () => {
      message.error('Failed to update dimension')
    },
  })

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (isEditing && dimension) {
        await updateMutation.mutateAsync({
          workspace_id: workspaceId,
          id: dimension.id,
          name: values.name,
          category: values.category,
          defaultValue: values.defaultValue,
          rules: values.rules,
        })
      } else {
        await createMutation.mutateAsync({
          workspace_id: workspaceId,
          name: values.name,
          slot: values.slot,
          category: values.category,
          defaultValue: values.defaultValue,
          rules: values.rules,
        })
      }
    } catch {
      // Validation failed
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Modal
      title={isEditing ? 'Edit Custom Dimension' : 'Create Custom Dimension'}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={isEditing ? 'Save' : 'Create'}
      confirmLoading={isPending}
      width={700}
      destroyOnClose
    >
      <Form form={form} layout="vertical" className="mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="e.g., Channel Grouping" />
          </Form.Item>

          <Form.Item
            name="slot"
            label="Slot"
            rules={[{ required: !isEditing, message: 'Slot is required' }]}
            tooltip={isEditing ? 'Slot cannot be changed after creation' : undefined}
          >
            <Select
              options={availableSlots}
              placeholder="Select slot"
              disabled={isEditing}
            />
          </Form.Item>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item name="category" label="Category">
            <AutoComplete
              options={categoryOptions}
              placeholder="e.g., Custom"
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item name="defaultValue" label="Default Value">
            <Input placeholder="Value when no rule matches" />
          </Form.Item>
        </div>

        <Form.Item
          name="rules"
          label="Rules"
          rules={[
            { required: true, message: 'At least one rule is required' },
            {
              validator: (_, rules: CustomDimensionRule[]) => {
                if (!rules || rules.length === 0) {
                  return Promise.reject('At least one rule is required')
                }
                for (const rule of rules) {
                  if (!rule.outputValue?.trim()) {
                    return Promise.reject('All rules must have an output value')
                  }
                  for (const condition of rule.conditions) {
                    if (!condition.value?.trim()) {
                      return Promise.reject('All conditions must have a value')
                    }
                  }
                }
                return Promise.resolve()
              },
            },
          ]}
        >
          <RuleBuilder
            value={form.getFieldValue('rules') || []}
            onChange={(rules) => form.setFieldValue('rules', rules)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
