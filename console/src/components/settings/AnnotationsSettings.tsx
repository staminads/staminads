import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Button, Modal, Form, Input, DatePicker, Select, message, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'
import { api } from '../../lib/api'
import type { Workspace, Annotation } from '../../types/workspace'

interface AnnotationsSettingsProps {
  workspace: Workspace
}

const DEFAULT_COLOR = '#7763f1'

const PRESET_COLORS = [
  '#7763f1', // Purple (primary)
  '#22c55e', // Green (positive events)
  '#ef4444', // Red (incidents/issues)
  '#f59e0b', // Orange (warnings)
  '#3b82f6', // Blue (informational)
  '#6b7280', // Gray (neutral)
]

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
]

export function AnnotationsSettings({ workspace }: AnnotationsSettingsProps) {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null)
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR)
  const [form] = Form.useForm()

  const annotations = workspace.settings.annotations ?? []

  const updateMutation = useMutation({
    mutationFn: api.workspaces.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspace.id] })
      setIsModalOpen(false)
      setEditingAnnotation(null)
      form.resetFields()
      message.success(editingAnnotation ? 'Annotation updated' : 'Annotation added')
    },
    onError: () => {
      message.error('Failed to save annotation')
    },
  })

  const handleAdd = () => {
    setEditingAnnotation(null)
    form.resetFields()
    form.setFieldsValue({
      timezone: workspace.timezone,
    })
    setSelectedColor(DEFAULT_COLOR)
    setIsModalOpen(true)
  }

  const handleEdit = (annotation: Annotation) => {
    setEditingAnnotation(annotation)
    form.setFieldsValue({
      date: dayjs(annotation.date),
      timezone: annotation.timezone || workspace.timezone,
      title: annotation.title,
      description: annotation.description,
    })
    setSelectedColor(annotation.color || DEFAULT_COLOR)
    setIsModalOpen(true)
  }

  const handleDelete = (id: string) => {
    const updatedAnnotations = annotations.filter((a) => a.id !== id)
    updateMutation.mutate({
      id: workspace.id,
      settings: { annotations: updatedAnnotations },
    })
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      const annotation: Annotation = {
        id: editingAnnotation?.id ?? nanoid(),
        date: values.date.format('YYYY-MM-DD'),
        timezone: values.timezone,
        title: values.title,
        description: values.description || undefined,
        color: selectedColor,
      }

      let updatedAnnotations: Annotation[]
      if (editingAnnotation) {
        updatedAnnotations = annotations.map((a) => (a.id === editingAnnotation.id ? annotation : a))
      } else {
        updatedAnnotations = [...annotations, annotation]
      }

      // Sort by date descending
      updatedAnnotations.sort((a, b) => b.date.localeCompare(a.date))

      updateMutation.mutate({
        id: workspace.id,
        settings: { annotations: updatedAnnotations },
      })
    })
  }

  const columns = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 140,
      render: (_: string, record: Annotation) => (
        <div>
          <div className="font-semibold">{dayjs(record.date).format('MMM D, YYYY')}</div>
          <div className="text-xs text-gray-400">{record.timezone}</div>
        </div>
      ),
    },
    {
      title: 'Annotation',
      key: 'annotation',
      render: (_: unknown, record: Annotation) => (
        <div className="flex items-start gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
            style={{ backgroundColor: record.color || DEFAULT_COLOR }}
          />
          <div>
            <div className="font-semibold">{record.title}</div>
            {record.description && (
              <div className="text-sm text-gray-500">{record.description}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Annotation) => (
        <div className="flex gap-1">
          <Popconfirm
            title="Delete annotation?"
            description="This action cannot be undone."
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="max-w-2xl">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium">Annotations</h3>
          <p className="text-gray-500 text-sm">
            Mark significant dates on your dashboard charts, like product launches or campaigns.
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          Add Annotation
        </Button>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <Table
          dataSource={annotations}
          columns={columns}
          rowKey="id"
          pagination={false}
          showHeader={false}
          locale={{ emptyText: 'No annotations yet' }}
        />
      </div>

      <Modal
        title={editingAnnotation ? 'Edit Annotation' : 'Add Annotation'}
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false)
          setEditingAnnotation(null)
          form.resetFields()
        }}
        onOk={handleSave}
        confirmLoading={updateMutation.isPending}
        okText={editingAnnotation ? 'Save' : 'Add'}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <div className="flex gap-4 items-end">
            <Form.Item
              name="date"
              label="Date"
              rules={[{ required: true, message: 'Date is required' }]}
              className="flex-1"
            >
              <DatePicker className="w-full" />
            </Form.Item>

            <Form.Item label="Color">
              <div className="flex gap-1">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      selectedColor === color
                        ? 'border-gray-800 scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </Form.Item>
          </div>

          <Form.Item
            name="timezone"
            label="Timezone"
            rules={[{ required: true, message: 'Timezone is required' }]}
          >
            <Select
              showSearch
              placeholder="Select timezone"
              optionFilterProp="label"
              options={COMMON_TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
            />
          </Form.Item>

          <Form.Item
            name="title"
            label="Title"
            rules={[
              { required: true, message: 'Title is required' },
              { max: 100, message: 'Title must be 100 characters or less' },
            ]}
          >
            <Input placeholder="e.g., Product Launch X" maxLength={100} />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description (optional)"
            rules={[{ max: 500, message: 'Description must be 500 characters or less' }]}
          >
            <Input.TextArea
              placeholder="Additional context about this event"
              maxLength={500}
              rows={3}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
