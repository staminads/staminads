import { useState, useEffect, useMemo } from 'react'
import { Drawer, Form, Input, Radio, Select, Checkbox, Button, message, Alert, Tag, Row, Col } from 'antd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Filter } from '../../types/analytics'
import type { Subscription, CreateSubscriptionInput, UpdateSubscriptionInput, PreviewSubscriptionInput } from '../../types/subscription'
import { SUBSCRIPTION_WIDGETS, AVAILABLE_METRICS, AVAILABLE_LIMITS } from '../../types/subscription'
import { PreviewDrawer } from './PreviewDrawer'

// Build timezone options with workspace timezone first
const buildTimezoneOptions = (workspaceTimezone: string) => {
  const allTimezones = Intl.supportedValuesOf('timeZone')
  return [
    { value: workspaceTimezone, label: workspaceTimezone },
    ...allTimezones.filter((tz) => tz !== workspaceTimezone).map((tz) => ({
      value: tz,
      label: tz,
    })),
  ]
}

const DAYS_OF_WEEK = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0') + ':00',
}))

const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => ({
  value: i + 1,
  label: (i + 1).toString(),
}))

interface SubscribeDrawerProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  filters: Filter[]
  timezone: string
  subscription?: Subscription  // For edit mode
}

export function SubscribeDrawer({
  open,
  onClose,
  workspaceId,
  filters,
  timezone,
  subscription,
}: SubscribeDrawerProps) {
  const [form] = Form.useForm()
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const isEditing = !!subscription

  // Watch frequency field to conditionally render day_of_week/day_of_month
  const frequency = Form.useWatch('frequency', form) ?? 'daily'

  // Build timezone options with workspace timezone first
  const timezoneOptions = useMemo(() => buildTimezoneOptions(timezone), [timezone])

  const createMutation = useMutation({
    mutationFn: (data: CreateSubscriptionInput) => api.subscriptions.create(data),
    onSuccess: () => {
      message.success('Subscription created successfully')
      queryClient.invalidateQueries({ queryKey: ['subscriptions', workspaceId] })
      handleClose()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: UpdateSubscriptionInput) => api.subscriptions.update(data),
    onSuccess: () => {
      message.success('Subscription updated successfully')
      queryClient.invalidateQueries({ queryKey: ['subscriptions', workspaceId] })
      handleClose()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const previewMutation = useMutation({
    mutationFn: (data: PreviewSubscriptionInput) => api.subscriptions.preview(data),
    onSuccess: (response) => {
      setPreviewHtml(response.html)
      setPreviewOpen(true)
    },
    onError: (err: Error) => {
      message.error(err.message || 'Failed to generate preview')
    },
  })

  // Populate form when editing or set defaults when creating
  useEffect(() => {
    if (open && subscription) {
      form.setFieldsValue({
        name: subscription.name,
        frequency: subscription.frequency,
        day_of_week: subscription.day_of_week,
        day_of_month: subscription.day_of_month,
        hour: subscription.hour,
        timezone: subscription.timezone,
        dimensions: subscription.dimensions,
        limit: subscription.limit,
      })
    } else if (open) {
      form.resetFields()
      form.setFieldValue('timezone', timezone)
    }
  }, [open, subscription, form, timezone])

  const handleClose = () => {
    form.resetFields()
    setError(null)
    onClose()
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setError(null)

      if (isEditing && subscription) {
        const updateData: UpdateSubscriptionInput = {
          id: subscription.id,
          workspace_id: workspaceId,
          name: values.name,
          frequency: values.frequency,
          hour: values.hour,
          timezone: values.timezone,
          metrics: AVAILABLE_METRICS.map((m) => m.key),
          dimensions: values.dimensions || [],
          limit: values.limit,
        }

        if (values.frequency === 'weekly') {
          updateData.day_of_week = values.day_of_week
        }
        if (values.frequency === 'monthly') {
          updateData.day_of_month = values.day_of_month
        }

        updateMutation.mutate(updateData)
      } else {
        const createData: CreateSubscriptionInput = {
          workspace_id: workspaceId,
          name: values.name,
          frequency: values.frequency,
          hour: values.hour,
          timezone: values.timezone,
          metrics: AVAILABLE_METRICS.map((m) => m.key),
          dimensions: values.dimensions || [],
          filters: filters,
          limit: values.limit,
        }

        if (values.frequency === 'weekly') {
          createData.day_of_week = values.day_of_week
        }
        if (values.frequency === 'monthly') {
          createData.day_of_month = values.day_of_month
        }

        createMutation.mutate(createData)
      }
    } catch {
      // Form validation failed
    }
  }

  const handlePreview = async () => {
    try {
      const values = await form.validateFields()
      previewMutation.mutate({
        workspace_id: workspaceId,
        name: values.name || 'Preview Report',
        frequency: values.frequency,
        day_of_week: values.frequency === 'weekly' ? values.day_of_week : undefined,
        day_of_month: values.frequency === 'monthly' ? values.day_of_month : undefined,
        metrics: AVAILABLE_METRICS.map((m) => m.key),
        dimensions: values.dimensions || [],
        filters: filters,
        limit: values.limit,
      })
    } catch {
      // Form validation failed
    }
  }

  return (
    <>
    <Drawer
      title={isEditing ? 'Edit Subscription' : 'Subscribe to Report'}
      placement="right"
      width={480}
      open={open}
      onClose={handleClose}
      styles={{ body: { paddingBottom: 80 } }}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="primary" ghost onClick={handlePreview} loading={previewMutation.isPending}>
            Preview
          </Button>
          <Button type="primary" onClick={handleSubmit} loading={createMutation.isPending || updateMutation.isPending}>
            {isEditing ? 'Save Changes' : 'Subscribe'}
          </Button>
        </div>
      }
    >
      {error && (
        <Alert message={error} type="error" showIcon className="mb-4" closable onClose={() => setError(null)} />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          frequency: 'daily',
          hour: 8,
          timezone: timezone,
          limit: 10,
        }}
      >
        <Form.Item
          name="name"
          label="Report Name"
          rules={[{ required: true, message: 'Please enter a name' }]}
        >
          <Input placeholder="e.g., Daily Traffic Summary" />
        </Form.Item>

        <Form.Item name="frequency" label="Frequency" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio.Button value="daily">Daily</Radio.Button>
            <Radio.Button value="weekly">Weekly</Radio.Button>
            <Radio.Button value="monthly">Monthly</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {frequency === 'weekly' && (
          <Form.Item
            name="day_of_week"
            label="Day of Week"
            rules={[{ required: true, message: 'Please select a day' }]}
          >
            <Select options={DAYS_OF_WEEK} placeholder="Select day" />
          </Form.Item>
        )}

        {frequency === 'monthly' && (
          <Form.Item
            name="day_of_month"
            label="Day of Month"
            rules={[{ required: true, message: 'Please select a day' }]}
          >
            <Select options={DAYS_OF_MONTH} placeholder="Select day" />
          </Form.Item>
        )}

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="hour" label="Send Time" rules={[{ required: true }]}>
              <Select options={HOURS} />
            </Form.Item>
          </Col>
          <Col span={16}>
            <Form.Item name="timezone" label="Timezone" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={timezoneOptions}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="limit" label="Results per Widget" rules={[{ required: true }]}>
          <Radio.Group>
            {AVAILABLE_LIMITS.map((l) => (
              <Radio.Button key={l} value={l}>{l}</Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>

        {filters.length > 0 && (
          <div className="bg-gray-50 p-3 rounded-lg mb-4">
            <div className="text-xs font-medium text-gray-500 mb-1">With Filters</div>
            <div className="flex flex-wrap gap-1">
              {filters.map((f, i) => (
                <Tag key={i} color="orange" bordered={false}>
                  {f.dimension} {f.operator} {f.values?.join(', ')}
                </Tag>
              ))}
            </div>
          </div>
        )}

        <Form.Item
          name="dimensions"
          label={
            <div className="relative">
              <span>Widgets</span>
              <a
                className="absolute right-0"
                style={{ right: '-350px' }}
                onClick={() => {
                  const allKeys = SUBSCRIPTION_WIDGETS.flatMap((c) => c.tabs.map((t) => t.key))
                  form.setFieldValue('dimensions', allKeys)
                }}
              >
                select all
              </a>
            </div>
          }
        >
          <Checkbox.Group style={{ width: '100%' }}>
            <Row gutter={16}>
              <Col span={12}>
                {/* Left: Top Pages (2), Top Sources (3), Countries (1), Goals (1) = 7 items */}
                {[0, 1, 3, 5].map((idx) => SUBSCRIPTION_WIDGETS[idx]).map((category) => (
                  <div key={category.category} className="mb-5">
                    <div className="text-xs font-medium text-gray-500 mb-1">{category.category}</div>
                    <div className="flex flex-col gap-1 ml-2">
                      {category.tabs.map((tab) => (
                        <Checkbox key={tab.key} value={tab.key}>
                          {tab.label}
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
              </Col>
              <Col span={12}>
                {/* Right: Top Campaigns (5), Devices (3) = 8 items */}
                {[2, 4].map((idx) => SUBSCRIPTION_WIDGETS[idx]).map((category) => (
                  <div key={category.category} className="mb-5">
                    <div className="text-xs font-medium text-gray-500 mb-1">{category.category}</div>
                    <div className="flex flex-col gap-1 ml-2">
                      {category.tabs.map((tab) => (
                        <Checkbox key={tab.key} value={tab.key}>
                          {tab.label}
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
              </Col>
            </Row>
          </Checkbox.Group>
        </Form.Item>
      </Form>
    </Drawer>

    <PreviewDrawer
      open={previewOpen}
      onClose={() => setPreviewOpen(false)}
      html={previewHtml}
      loading={previewMutation.isPending}
    />
  </>
  )
}
