import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Badge,
  Typography,
  Popconfirm,
  Alert,
  DatePicker,
  App,
  Space,
  Tooltip,
  Empty,
} from 'antd'
import { PlusOutlined, CopyOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons'
import { api } from '../../lib/api'
import type { PublicApiKey, ApiScope, CreateApiKeyInput, ApiKeyRole } from '../../types/api-keys'
import { API_KEY_ROLES } from '../../types/api-keys'
import dayjs, { Dayjs } from 'dayjs'

const roleColors: Record<ApiKeyRole, string> = {
  admin: 'purple',
  editor: 'blue',
  viewer: 'default',
}

const roleOptions = Object.entries(API_KEY_ROLES).map(([value, { label, description }]) => ({
  value,
  label: (
    <div>
      <div>{label}</div>
      <div className="text-xs text-gray-400">{description}</div>
    </div>
  ),
}))

// Determine role from scopes (for display)
function getRoleFromScopes(scopes: ApiScope[]): ApiKeyRole | null {
  const scopeSet = new Set(scopes)
  for (const [role, config] of Object.entries(API_KEY_ROLES) as [ApiKeyRole, typeof API_KEY_ROLES[ApiKeyRole]][]) {
    const roleScopes = new Set(config.scopes)
    if (scopeSet.size === roleScopes.size && [...scopeSet].every(s => roleScopes.has(s))) {
      return role
    }
  }
  return null // Custom scopes that don't match any role
}

const { Text } = Typography

interface ApiKeysPageProps {
  workspaceId: string
}

export function ApiKeysPage({ workspaceId }: ApiKeysPageProps) {
  const queryClient = useQueryClient()
  const { message: messageApi } = App.useApp()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newKeyResponse, setNewKeyResponse] = useState<{ key: string; name: string } | null>(null)
  const [form] = Form.useForm()

  // Fetch current user to get user ID
  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: api.auth.me,
  })

  // Fetch API keys for this workspace
  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['apiKeys', workspaceId],
    queryFn: () => api.apiKeys.list(workspaceId),
  })

  // Create API key mutation
  const createMutation = useMutation({
    mutationFn: api.apiKeys.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', workspaceId] })
      setIsCreateModalOpen(false)
      setNewKeyResponse({ key: data.key, name: data.apiKey.name })
      form.resetFields()
      messageApi.success('API key created successfully')
    },
    onError: (error: Error) => {
      messageApi.error(error.message)
    },
  })

  // Revoke API key mutation
  const revokeMutation = useMutation({
    mutationFn: api.apiKeys.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', workspaceId] })
      messageApi.success('API key revoked')
    },
    onError: (error: Error) => {
      messageApi.error(error.message)
    },
  })

  const handleCreateKey = (values: {
    name: string
    description?: string
    role: ApiKeyRole
    expires_at?: Dayjs
  }) => {
    if (!currentUser) return

    const input: CreateApiKeyInput = {
      workspace_id: workspaceId,
      name: values.name,
      description: values.description,
      scopes: API_KEY_ROLES[values.role].scopes,
      expires_at: values.expires_at ? values.expires_at.toISOString() : undefined,
    }

    createMutation.mutate(input)
  }

  const handleRevokeKey = (id: string) => {
    if (!currentUser) return

    revokeMutation.mutate({
      id,
      revoked_by: currentUser.id,
    })
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'Never'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatDateTime = (date: string | null) => {
    if (!date) return 'Never'
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusInfo = (record: PublicApiKey): { status: 'success' | 'error' | 'warning'; text: string } => {
    if (record.status === 'revoked') return { status: 'error', text: 'Revoked' }
    if (record.expires_at && new Date(record.expires_at) < new Date()) return { status: 'warning', text: 'Expired' }
    return { status: 'success', text: 'Active' }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: PublicApiKey) => {
        const { status, text } = getStatusInfo(record)
        return (
          <div className="flex items-center gap-2">
            <Tooltip title={text}>
              <Badge status={status} />
            </Tooltip>
            <span>{name}</span>
          </div>
        )
      },
    },
    {
      title: 'Role',
      dataIndex: 'scopes',
      key: 'role',
      width: 100,
      render: (scopes: ApiScope[]) => {
        const role = getRoleFromScopes(scopes)
        if (role) {
          return (
            <Tag color={roleColors[role]}>
              {API_KEY_ROLES[role].label}
            </Tag>
          )
        }
        return <Tag color="default">Custom</Tag>
      },
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (date: string) => (
        <span className="text-xs text-gray-500">{formatDate(date)}</span>
      ),
    },
    {
      title: 'Last Used',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      width: 140,
      render: (date: string | null) => (
        <span className="text-xs text-gray-500">{formatDateTime(date)}</span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, record: PublicApiKey) => (
        <Popconfirm
          title="Revoke API Key"
          description="Are you sure you want to revoke this API key? This action cannot be undone."
          onConfirm={() => handleRevokeKey(record.id)}
          okText="Revoke"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
          disabled={record.status === 'revoked'}
        >
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            disabled={record.status === 'revoked'}
          />
        </Popconfirm>
      ),
    },
  ]

  return (
    <div className="max-w-xl">
      <div className="flex justify-end mb-4">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsCreateModalOpen(true)}
        >
          <span className="hidden md:inline">Create API Key</span>
          <span className="md:hidden">Create</span>
        </Button>
      </div>

      {/* Mobile: Card view */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <div className="bg-white rounded-lg p-6 text-center text-gray-500">
            <LoadingOutlined className="mr-2" />Loading...
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="bg-white rounded-lg p-6">
            <Empty description="No API keys" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          apiKeys.map((apiKey) => {
            const { status, text } = getStatusInfo(apiKey)
            const role = getRoleFromScopes(apiKey.scopes)
            const isDisabled = apiKey.status === 'revoked'

            return (
              <div key={apiKey.id} className={`bg-white rounded-lg border border-gray-200 p-4 ${isDisabled ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tooltip title={text}>
                      <Badge status={status} />
                    </Tooltip>
                    <span className="font-medium truncate">{apiKey.name}</span>
                  </div>
                  <div className="shrink-0">
                    {role ? (
                      <Tag color={roleColors[role]}>{API_KEY_ROLES[role].label}</Tag>
                    ) : (
                      <Tag color="default">Custom</Tag>
                    )}
                  </div>
                </div>
                <div className="text-gray-400 text-xs mt-2 space-y-1">
                  <div>Created {formatDate(apiKey.created_at)}</div>
                  <div>Last used {formatDateTime(apiKey.last_used_at)}</div>
                </div>
                {!isDisabled && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <Popconfirm
                      title="Revoke API Key"
                      description="Are you sure you want to revoke this API key? This action cannot be undone."
                      onConfirm={() => handleRevokeKey(apiKey.id)}
                      okText="Revoke"
                      cancelText="Cancel"
                      okButtonProps={{ danger: true }}
                    >
                      <Button block size="small" icon={<DeleteOutlined />}>
                        Revoke
                      </Button>
                    </Popconfirm>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Desktop: Table view */}
      <div className="hidden md:block">
        <Table
          dataSource={apiKeys}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={false}
          size="small"
        />
      </div>

      {/* Create API Key Modal */}
      <Modal
        title="Create API Key"
        open={isCreateModalOpen}
        onCancel={() => {
          setIsCreateModalOpen(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        okText="Create"
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateKey}
          initialValues={{ role: 'editor' }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, message: 'Name is required' },
              { max: 100, message: 'Name must be 100 characters or less' },
            ]}
          >
            <Input placeholder="Production API Key" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description (optional)"
            rules={[{ max: 500, message: 'Description must be 500 characters or less' }]}
          >
            <Input.TextArea
              rows={2}
              placeholder="Used for production data ingestion"
            />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Please select a role' }]}
          >
            <Select
              options={roleOptions}
              placeholder="Select a role"
              optionLabelProp="label"
              optionRender={(option) => {
                const role = option.value as ApiKeyRole
                const config = API_KEY_ROLES[role]
                return (
                  <div className="py-1">
                    <div className="font-medium">{config.label}</div>
                    <div className="text-xs text-gray-500">{config.description}</div>
                  </div>
                )
              }}
            />
          </Form.Item>

          <Form.Item
            name="expires_at"
            label="Expiration Date (optional)"
            tooltip="Leave empty for no expiration"
          >
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm"
              disabledDate={(current) => current && current < dayjs().startOf('day')}
              className="w-full"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Show Key Once Modal */}
      <Modal
        title="API Key Created"
        open={!!newKeyResponse}
        onCancel={() => setNewKeyResponse(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setNewKeyResponse(null)}>
            Done
          </Button>,
        ]}
        width={650}
        closable={false}
        styles={{ body: { paddingTop: 20, paddingBottom: 20 } }}
      >
        <Alert
          description="This is the only time you will see this key. Make sure to save it securely."
          type="warning"
          className="!mb-4"
        />

        <div className="space-y-4">
          <div>
            <Text strong>Name:</Text> {newKeyResponse?.name}
          </div>

          <div>
            <Text strong>API Key:</Text>
            <Space.Compact className="mt-1 w-full">
              <Input
                value={newKeyResponse?.key}
                readOnly
                className="font-mono"
              />
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(newKeyResponse?.key || '')
                  messageApi.success('Copied to clipboard')
                }}
              >
                Copy
              </Button>
            </Space.Compact>
          </div>
        </div>
      </Modal>
    </div>
  )
}
