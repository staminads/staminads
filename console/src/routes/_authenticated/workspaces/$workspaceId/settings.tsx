import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Form, Input, InputNumber, Button, Select, message, Table, Tag, Modal, Avatar, Spin, Tooltip, Switch } from 'antd'
import { SearchOutlined, EditOutlined, LoadingOutlined, PlusOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { api } from '../../../../lib/api'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { IntegrationsSettings } from '../../../../components/settings/IntegrationsSettings'
import { TimeScoreDistribution } from '../../../../components/settings/TimeScoreDistribution'
import { TeamSettings } from '../../../../components/settings/TeamSettings'
import { CodeSnippet } from '../../../../components/setup/CodeSnippet'
import { SmtpPage } from '../../../../pages/settings/smtp'
import { ApiKeysPage } from '../../../../pages/settings/api-keys'
import { z } from 'zod'

const settingsSearchSchema = z.object({
  section: z.enum(['workspace', 'dimensions', 'team', 'integrations', 'smtp', 'api-keys', 'privacy', 'sdk', 'danger']).optional().default('workspace'),
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

type SettingsSection = 'workspace' | 'dimensions' | 'team' | 'integrations' | 'smtp' | 'api-keys' | 'privacy' | 'sdk' | 'danger'

const menuItems: { key: SettingsSection; label: string; ownerOnly?: boolean }[] = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'dimensions', label: 'Custom Dimensions' },
  { key: 'team', label: 'Team' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'smtp', label: 'Email (SMTP)' },
  { key: 'api-keys', label: 'API Keys' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'sdk', label: 'Install SDK' },
  { key: 'danger', label: 'Danger zone', ownerOnly: true },
]

function Settings() {
  const { workspaceId } = Route.useParams()
  const { section } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))


  // Fetch current user
  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: api.auth.me,
  })

  // Fetch members to get current user's role (needed to show owner-only tabs)
  const { data: members = [] } = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api.members.list(workspaceId),
  })

  // Get current user's role
  const currentMember = members.find(m => m.user_id === currentUser?.id)
  const userRole = currentMember?.role || 'viewer'
  const isOwner = userRole === 'owner'

  // Check if workspace has sessions
  const { data: sessionCount } = useQuery({
    queryKey: ['workspace-sessions', workspaceId],
    queryFn: async () => {
      const result = await api.analytics.query({
        workspace_id: workspaceId,
        metrics: ['sessions'],
        dateRange: { preset: 'all_time' }
      })
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        return (result.data[0] as Record<string, unknown>)?.sessions as number ?? 0
      }
      return 0
    },
    refetchInterval: section === 'sdk' ? 3000 : false, // Poll only when on SDK section
  })

  const setActiveSection = (newSection: SettingsSection) => {
    navigate({ to: '.', search: { section: newSection } })
  }

  const [form] = Form.useForm()
  const [detectingLogo, setDetectingLogo] = useState(false)
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [allowedDomains, setAllowedDomains] = useState<string[]>(workspace.settings.allowed_domains || [])
  const [domainInput, setDomainInput] = useState('')
  const [geoEnabled, setGeoEnabled] = useState(workspace.settings.geo_enabled ?? true)
  const [geoStoreCity, setGeoStoreCity] = useState(workspace.settings.geo_store_city ?? true)
  const [geoStoreRegion, setGeoStoreRegion] = useState(workspace.settings.geo_store_region ?? true)
  const [geoCoordinatesPrecision, setGeoCoordinatesPrecision] = useState(workspace.settings.geo_coordinates_precision ?? 2)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const updateWorkspaceMutation = useMutation({
    mutationFn: api.workspaces.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      message.success('Workspace settings saved')
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to save workspace settings')
    },
  })

  const updateLabelMutation = useMutation({
    mutationFn: api.workspaces.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] })
      setEditingSlot(null)
      message.success('Label updated')
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to update label')
    },
  })

  const deleteWorkspaceMutation = useMutation({
    mutationFn: () => api.workspaces.delete(workspaceId),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['workspaces'] })
      message.success('Workspace deleted')
      navigate({ to: '/workspaces' })
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to delete workspace')
    },
  })

  const onFinish = (values: { name: string; website: string; logo_url?: string; timezone: string; currency: string; timescore_reference?: number; bounce_threshold?: number }) => {
    updateWorkspaceMutation.mutate({
      id: workspaceId,
      name: values.name,
      website: values.website,
      logo_url: values.logo_url,
      timezone: values.timezone,
      currency: values.currency,
      settings: {
        // Preserve all existing settings, only update form-managed fields
        ...workspace.settings,
        timescore_reference: values.timescore_reference,
        bounce_threshold: values.bounce_threshold,
        allowed_domains: allowedDomains.length > 0 ? allowedDomains : undefined,
      },
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
    const cd = workspace.settings.custom_dimensions
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
      settings: { ...workspace.settings, custom_dimensions: updatedLabels },
    })
  }

  const logoUrl = Form.useWatch('logo_url', form)

  const handleAddDomain = () => {
    const trimmed = domainInput.trim().toLowerCase()
    if (!trimmed) return
    if (allowedDomains.includes(trimmed)) {
      message.warning('Domain already added')
      return
    }
    setAllowedDomains([...allowedDomains, trimmed])
    setDomainInput('')
  }

  const handleRemoveDomain = (domain: string) => {
    setAllowedDomains(allowedDomains.filter(d => d !== domain))
  }

  const savePrivacySettings = () => {
    updateWorkspaceMutation.mutate({
      id: workspaceId,
      settings: {
        ...workspace.settings,
        geo_enabled: geoEnabled,
        geo_store_city: geoStoreCity,
        geo_store_region: geoStoreRegion,
        geo_coordinates_precision: geoCoordinatesPrecision,
      },
    })
  }

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
            timescore_reference: workspace.settings.timescore_reference,
            bounce_threshold: workspace.settings.bounce_threshold ?? 10,
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
              timescoreReference={workspace.settings.timescore_reference ?? 60}
            />
          </div>

          <Form.Item
            name="bounce_threshold"
            label="Bounce Threshold (seconds)"
            tooltip="Sessions shorter than this duration are counted as bounces. Default is 10 seconds."
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label={
              <span>
                Allowed Domains{' '}
                <Tooltip title="Restrict tracking to specific domains. Leave empty to allow all domains. Supports wildcards like *.example.com">
                  <InfoCircleOutlined className="text-gray-400" />
                </Tooltip>
              </span>
            }
          >
            <div className="space-y-2">
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="example.com or *.example.com"
                onPressEnter={(e) => {
                  e.preventDefault()
                  handleAddDomain()
                }}
                suffix={
                  <Button
                    type="link"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={handleAddDomain}
                    className="!p-0 !h-auto"
                  >
                    Add
                  </Button>
                }
              />
              {allowedDomains.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {allowedDomains.map((domain) => (
                    <Tag
                      key={domain}
                      closable
                      onClose={() => handleRemoveDomain(domain)}
                    >
                      {domain}
                    </Tag>
                  ))}
                </div>
              )}
              {allowedDomains.length === 0 && (
                <div className="text-gray-400 text-sm">All domains allowed (no restrictions)</div>
              )}
            </div>
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
              render: (slot: number) => <Tag color="purple">stm_{slot}</Tag>,
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
              <Input value={`stm_${editingSlot}`} disabled />
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

  // Generate the SDK snippet with workspace_id pre-filled and version for cache busting
  const sdkSnippet = `<!-- Staminads -->
<script>
window.StaminadsConfig = {
  workspace_id: '${workspaceId}',
  endpoint: '${window.location.origin}'
};
</script>
<script async src="${window.location.origin}/sdk/staminads_${__APP_VERSION__}.min.js"></script>`

  const sdkContent = (
    <div className="max-w-xl">
      <CodeSnippet code={sdkSnippet} />
      <p className="text-gray-500 mt-4">
        Add this code snippet to your website's <code>&lt;head&gt;</code> or <code>&lt;body&gt;</code> tag.
      </p>
      {sessionCount === 0 && (
        <div className="mt-6 flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 20 }} spin />} />
          <div>
            <div className="font-medium text-blue-900">Waiting for first event...</div>
            <div className="text-sm text-blue-700">
              Install the SDK on your website and we'll detect it automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const privacyContent = (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
      <h3 className="text-lg font-medium mb-4">Geographic Data Collection</h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable geo-location tracking</div>
            <div className="text-sm text-gray-500">Track visitor country, region, city, and coordinates</div>
          </div>
          <Switch checked={geoEnabled} onChange={setGeoEnabled} />
        </div>

        {geoEnabled && (
          <div className="ml-6 border-l-2 border-gray-100 pl-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Store city name</div>
                <div className="text-sm text-gray-500">Record the city of visitors</div>
              </div>
              <Switch checked={geoStoreCity} onChange={setGeoStoreCity} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Store region/state name</div>
                <div className="text-sm text-gray-500">Record the region or state of visitors</div>
              </div>
              <Switch checked={geoStoreRegion} onChange={setGeoStoreRegion} />
            </div>

            <div>
              <div className="font-medium mb-1">Coordinates precision</div>
              <div className="text-sm text-gray-500 mb-2">Lower precision = more privacy</div>
              <Select
                value={geoCoordinatesPrecision}
                onChange={setGeoCoordinatesPrecision}
                style={{ width: '100%' }}
                options={[
                  { value: 0, label: 'Country level (~111km precision)' },
                  { value: 1, label: 'Regional (~11km precision)' },
                  { value: 2, label: 'City level (~1km precision)' },
                ]}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 p-3 bg-blue-50 rounded text-sm text-blue-700">
        IP addresses are never stored — only used for geo lookup. Country is always included when geo tracking is enabled.
      </div>

      <div className="mt-6">
        <Button
          type="primary"
          onClick={savePrivacySettings}
          loading={updateWorkspaceMutation.isPending}
        >
          Save Changes
        </Button>
      </div>
    </div>
  )

  const dangerContent = (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl border border-red-200">
      <h3 className="text-lg font-medium text-red-600 mb-4">Delete Workspace</h3>
      <p className="text-gray-600 mb-4">
        Once you delete a workspace, there is no going back. This will permanently delete all
        analytics data, team members, API keys, and settings.
      </p>
      <Button danger onClick={() => setDeleteConfirmOpen(true)}>
        Delete this workspace
      </Button>

      <Modal
        title="Delete Workspace"
        open={deleteConfirmOpen}
        onCancel={() => {
          setDeleteConfirmOpen(false)
          setDeleteConfirmText('')
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setDeleteConfirmOpen(false)
            setDeleteConfirmText('')
          }}>
            Cancel
          </Button>,
          <Button
            key="delete"
            danger
            type="primary"
            loading={deleteWorkspaceMutation.isPending}
            disabled={deleteConfirmText !== workspace.name}
            onClick={() => deleteWorkspaceMutation.mutate()}
          >
            Delete
          </Button>,
        ]}
      >
        <p className="mb-4">
          This action cannot be undone. This will permanently delete the workspace
          <strong> {workspace.name}</strong> and all of its data.
        </p>
        <p className="mb-2">Please type <strong>{workspace.name}</strong> to confirm:</p>
        <Input
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder={workspace.name}
        />
      </Modal>
    </div>
  )

  return (
    <div className="flex-1 p-6">
      <h1 className="hidden md:block text-2xl font-light text-gray-800 mb-6">Settings</h1>

      <div className="flex gap-6">
        {/* Sidebar Menu - hidden on mobile, accessible via hamburger menu */}
        <div className="hidden md:block w-56 flex-shrink-0">
          <nav className="space-y-1">
            {menuItems
              .filter((item) => !item.ownerOnly || isOwner)
              .map((item) => {
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
          {section === 'team' && <TeamSettings workspaceId={workspaceId} userRole={userRole} />}
          {section === 'integrations' && <IntegrationsSettings workspace={workspace} />}
          {section === 'smtp' && <SmtpPage workspaceId={workspaceId} />}
          {section === 'api-keys' && <ApiKeysPage workspaceId={workspaceId} />}
          {section === 'privacy' && privacyContent}
          {section === 'sdk' && sdkContent}
          {section === 'danger' && isOwner && dangerContent}
        </div>
      </div>
    </div>
  )
}
