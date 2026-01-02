import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Form, Input, InputNumber, Button, Select, message, Table, Tag, Modal, Avatar } from 'antd'
import { SearchOutlined, EditOutlined } from '@ant-design/icons'
import { api } from '../../../../lib/api'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { IntegrationsSettings } from '../../../../components/settings/IntegrationsSettings'
import { TimeScoreDistribution } from '../../../../components/settings/TimeScoreDistribution'
import { z } from 'zod'

const settingsSearchSchema = z.object({
  section: z.enum(['workspace', 'dimensions', 'integrations']).optional().default('workspace'),
})

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/settings')({
  component: Settings,
  validateSearch: settingsSearchSchema,
})

const timezoneOptions = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST)' },
  { value: 'America/Denver', label: 'America/Denver (MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'America/Toronto', label: 'America/Toronto' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST)' },
]

const currencyOptions = [
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
  { value: 'CAD', label: 'CAD - Canadian Dollar' },
  { value: 'AUD', label: 'AUD - Australian Dollar' },
  { value: 'CHF', label: 'CHF - Swiss Franc' },
  { value: 'CNY', label: 'CNY - Chinese Yuan' },
  { value: 'INR', label: 'INR - Indian Rupee' },
  { value: 'BRL', label: 'BRL - Brazilian Real' },
]

type SettingsSection = 'workspace' | 'dimensions' | 'integrations'

const menuItems = [
  { key: 'workspace' as const, label: 'Workspace' },
  { key: 'dimensions' as const, label: 'Custom Dimensions' },
  { key: 'integrations' as const, label: 'Integrations' },
]

function Settings() {
  const { workspaceId } = Route.useParams()
  const { section } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  const setActiveSection = (newSection: SettingsSection) => {
    navigate({ search: { section: newSection } })
  }

  const [form] = Form.useForm()
  const [detectingLogo, setDetectingLogo] = useState(false)
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [newLabel, setNewLabel] = useState('')

  const updateWorkspaceMutation = useMutation({
    mutationFn: api.workspaces.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      message.success('Workspace settings saved')
    },
    onError: () => {
      message.error('Failed to save workspace settings')
    },
  })

  const updateLabelMutation = useMutation({
    mutationFn: api.workspaces.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] })
      setEditingSlot(null)
      message.success('Label updated')
    },
    onError: () => {
      message.error('Failed to update label')
    },
  })

  const onFinish = (values: { name: string; website: string; logo_url?: string; timezone: string; currency: string; timescore_reference?: number; bounce_threshold?: number }) => {
    updateWorkspaceMutation.mutate({
      id: workspaceId,
      ...values,
    })
  }

  const detectLogo = async () => {
    const website = form.getFieldValue('website')
    if (!website) {
      message.warning('Please enter a website URL first')
      return
    }

    try {
      setDetectingLogo(true)
      const meta = await api.tools.websiteMeta(website)
      if (meta.logo_url) {
        form.setFieldValue('logo_url', meta.logo_url)
        message.success('Logo detected')
      } else {
        message.info('No logo found for this website')
      }
    } catch {
      message.error('Failed to detect logo')
    } finally {
      setDetectingLogo(false)
    }
  }

  // Helper to get labels from custom_dimensions, handling legacy formats
  const getLabels = (): Record<string, string> => {
    const cd = workspace.custom_dimensions
    if (!cd) return {}
    // If it's already a simple label map (Record<string, string>)
    if (typeof cd === 'object' && !Array.isArray(cd)) {
      // Check if values are strings (new format) or objects (old format)
      const firstValue = Object.values(cd)[0]
      if (firstValue === undefined || typeof firstValue === 'string') {
        return cd as Record<string, string>
      }
    }
    // Legacy format or invalid - return empty
    return {}
  }

  const handleEditClick = (slot: number) => {
    const labels = getLabels()
    setEditingSlot(slot)
    setNewLabel(labels[String(slot)] ?? '')
  }

  const handleSaveLabel = () => {
    if (editingSlot === null) return

    const currentLabels = getLabels()
    const updatedLabels = { ...currentLabels }

    if (newLabel.trim()) {
      updatedLabels[String(editingSlot)] = newLabel.trim()
    } else {
      delete updatedLabels[String(editingSlot)]
    }

    updateLabelMutation.mutate({
      id: workspaceId,
      custom_dimensions: updatedLabels,
    })
  }

  const logoUrl = Form.useWatch('logo_url', form)

  const workspaceContent = (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            name: workspace.name,
            website: workspace.website,
            logo_url: workspace.logo_url,
            timezone: workspace.timezone,
            currency: workspace.currency,
            timescore_reference: workspace.timescore_reference,
            bounce_threshold: workspace.bounce_threshold ?? 10,
          }}
        >
          <Form.Item
            name="name"
            label="Workspace Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="My Website" />
          </Form.Item>

          <Form.Item
            name="website"
            label="Website URL"
            rules={[
              { required: true, message: 'Website is required' },
              { type: 'url', message: 'Must be a valid URL' },
            ]}
          >
            <Input placeholder="https://example.com" />
          </Form.Item>

          <Form.Item name="logo_url" label="Logo URL">
            <Input
              placeholder="https://example.com/logo.png"
              suffix={
                <Button
                  type="link"
                  size="small"
                  icon={<SearchOutlined />}
                  loading={detectingLogo}
                  onClick={detectLogo}
                  className="!p-0 !h-auto"
                >
                  Detect
                </Button>
              }
              prefix={
                logoUrl ? (
                  <Avatar src={logoUrl} size="small" shape="square" className="mr-1" />
                ) : null
              }
            />
          </Form.Item>

          <Form.Item name="timezone" label="Timezone">
            <Select
              options={timezoneOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item name="currency" label="Currency">
            <Select
              options={currencyOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item
            name="timescore_reference"
            label="TimeScore Reference (seconds)"
            tooltip="Target median session duration for heat map coloring in Explore. Higher values = higher bar for 'green' engagement."
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>

          <div className="mb-6 -mt-2">
            <TimeScoreDistribution
              workspaceId={workspaceId}
              timescoreReference={workspace.timescore_reference ?? 60}
            />
          </div>

          <Form.Item
            name="bounce_threshold"
            label="Bounce Threshold (seconds)"
            tooltip="Sessions shorter than this duration are counted as bounces. Default is 10 seconds."
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item className="mb-0">
            <Button
              type="primary"
              htmlType="submit"
              loading={updateWorkspaceMutation.isPending}
            >
              Save Changes
            </Button>
          </Form.Item>
        </Form>
    </div>
  )

  // Get labels from workspace (using helper to handle legacy formats)
  const labels = getLabels()

  // Generate all 10 slots
  const allSlots = Array.from({ length: 10 }, (_, i) => {
    const slot = i + 1
    return {
      slot,
      label: labels[String(slot)] ?? null,
    }
  })

  const dimensionsContent = (
    <div className="bg-white rounded-lg shadow-sm max-w-xl">
        <Table
          dataSource={allSlots}
          rowKey="slot"
          pagination={false}
          columns={[
            {
              title: 'Slot',
              dataIndex: 'slot',
              key: 'slot',
              width: 100,
              render: (slot: number) => <Tag color="purple">cd_{slot}</Tag>,
            },
            {
              title: 'Label',
              dataIndex: 'label',
              key: 'label',
              render: (label: string | null) => (
                <span className={label ? 'font-medium' : 'text-gray-400 italic'}>
                  {label || '(empty)'}
                </span>
              ),
            },
            {
              title: 'Actions',
              key: 'actions',
              width: 100,
              render: (_, record) => (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleEditClick(record.slot)}
                >
                  Edit
                </Button>
              ),
            },
          ]}
        />

        <Modal
          title="Edit Dimension Label"
          open={editingSlot !== null}
          onCancel={() => setEditingSlot(null)}
          onOk={handleSaveLabel}
          confirmLoading={updateLabelMutation.isPending}
          okText="Save"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Slot</label>
              <Input value={`cd_${editingSlot}`} disabled />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Enter dimension label (leave empty to clear)"
              />
            </div>
          </div>
        </Modal>
    </div>
  )

  return (
    <div className="flex-1 p-6">
      <h1 className="text-2xl font-light text-gray-800 mb-6">Settings</h1>

      <div className="flex gap-6">
        {/* Sidebar Menu */}
        <div className="w-56 flex-shrink-0">
          <nav className="space-y-1">
            {menuItems.map((item) => {
              const isActive = section === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveSection(item.key)}
                  className={`w-full px-3 py-2 rounded-md text-left text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {section === 'workspace' && workspaceContent}
          {section === 'dimensions' && dimensionsContent}
          {section === 'integrations' && <IntegrationsSettings workspace={workspace} />}
        </div>
      </div>
    </div>
  )
}
