import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Form,
  Input,
  InputNumber,
  Button,
  Alert,
  Typography,
  Divider,
  Space,
  Tag,
  Popconfirm,
  Spin,
  App,
} from 'antd'
import {
  SaveOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { api } from '../../lib/api'
import type { SmtpSettings } from '../../types/smtp'

const { Title, Paragraph } = Typography

function PortSecurityHint({ port }: { port: number | null }) {
  if (!port) return null

  let hint = ''
  if (port === 465) {
    hint = 'Uses implicit TLS (SMTPS)'
  } else if (port === 587) {
    hint = 'Uses STARTTLS (recommended)'
  } else if (port === 25) {
    hint = 'Uses opportunistic STARTTLS'
  } else {
    hint = 'Uses STARTTLS if available'
  }

  return (
    <div className="text-xs text-gray-500 -mt-2 mb-4">
      • {hint}
    </div>
  )
}

interface SmtpPageProps {
  workspaceId: string
}

export function SmtpPage({ workspaceId }: SmtpPageProps) {
  const queryClient = useQueryClient()
  const { message: messageApi } = App.useApp()
  const [form] = Form.useForm()
  const [testEmail, setTestEmail] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const watchedPort = Form.useWatch('port', form)

  // Fetch SMTP info (status + settings in one call)
  const { data: smtpInfo, isLoading } = useQuery({
    queryKey: ['smtp-info', workspaceId],
    queryFn: () => api.smtp.info(workspaceId),
    staleTime: 30_000, // Prevent refetch on remount
  })

  const status = smtpInfo?.status
  const settings = smtpInfo?.settings

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: (data: SmtpSettings) => api.smtp.update(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-info', workspaceId] })
      messageApi.success('SMTP settings saved')
      setHasChanges(false)
    },
    onError: (error: Error) => {
      messageApi.error(error.message)
    },
  })

  // Delete settings mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.smtp.delete(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-info', workspaceId] })
      form.resetFields()
      messageApi.success('SMTP settings removed. Falling back to global configuration.')
      setHasChanges(false)
    },
    onError: (error: Error) => {
      messageApi.error(error.message)
    },
  })

  // Test email mutation
  const testMutation = useMutation({
    mutationFn: (to: string) => api.smtp.test(workspaceId, to),
    onSuccess: (result) => {
      if (result.success) {
        messageApi.success('Test email sent successfully')
      } else {
        messageApi.error(result.message)
      }
    },
    onError: (error: Error) => {
      messageApi.error(error.message)
    },
  })

  // Set form values when settings load
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        host: settings.host,
        port: settings.port,
        username: settings.username,
        password: settings.password ? '********' : '',
        from_name: settings.from_name,
        from_email: settings.from_email,
      })
    }
  }, [settings, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      // Build the update payload
      const updateData: SmtpSettings = {
        enabled: true,
        host: values.host,
        port: values.port,
        from_name: values.from_name,
        from_email: values.from_email,
      }

      // Only include username if provided
      if (values.username) {
        updateData.username = values.username
      }

      // Only include password if it's not the masked placeholder
      if (values.password && values.password !== '********') {
        updateData.password = values.password
      }

      updateMutation.mutate(updateData)
    } catch {
      // Form validation failed
    }
  }

  const handleValuesChange = () => {
    setHasChanges(true)
  }

  const handleTestEmail = () => {
    if (!testEmail) {
      messageApi.warning('Please enter a test email address')
      return
    }
    testMutation.mutate(testEmail)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spin />
      </div>
    )
  }

  const hasWorkspaceConfig = status?.source === 'workspace'

  return (
    <div className="space-y-6 max-w-xl">
      {/* Status Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <Title level={5} className="!mb-0">
            Email Delivery Status
          </Title>
          {status?.available ? (
            <Tag color="success" icon={<CheckCircleOutlined />}>
              Configured
            </Tag>
          ) : (
            <Tag color="error" icon={<CloseCircleOutlined />}>
              Not Configured
            </Tag>
          )}
        </div>

        {status?.source === 'global' && (
          <Alert
            type="info"
            message="Using Global SMTP"
            description={`Emails are being sent using the system's default SMTP configuration${status.from_email ? ` (${status.from_email})` : ''}. You can configure custom SMTP settings below to use your own email server.`}
            showIcon
            className="mt-4"
          />
        )}
      </div>

      {/* Settings Form */}
      <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleValuesChange}
          initialValues={{
            port: 587,
          }}
        >
          <div className="flex items-end gap-4">
            <Form.Item
              name="host"
              label="SMTP Host"
              rules={[{ required: true, message: 'Please enter SMTP host' }]}
              className="flex-1"
            >
              <Input placeholder="smtp.example.com" />
            </Form.Item>

            <Form.Item
              name="port"
              label="Port"
              rules={[{ required: true, message: 'Please enter port' }]}
            >
              <InputNumber
                min={1}
                max={65535}
                style={{ width: 80 }}
                placeholder="587"
              />
            </Form.Item>
          </div>
          <PortSecurityHint port={watchedPort} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              name="username"
              label="Username"
            >
              <Input placeholder="username or email" autoComplete="off" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              extra={settings?.password ? "Enter new password to update, or leave as ******** to keep existing" : undefined}
            >
              <Input.Password placeholder="••••••••" autoComplete="new-password" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              name="from_name"
              label="From Name"
              rules={[{ required: true, message: 'Please enter from name' }]}
            >
              <Input placeholder="Staminads Analytics" />
            </Form.Item>

            <Form.Item
              name="from_email"
              label="From Email"
              rules={[
                { required: true, message: 'Please enter from email' },
                { type: 'email', message: 'Please enter a valid email' },
              ]}
            >
              <Input placeholder="noreply@example.com" />
            </Form.Item>
          </div>

          <Divider />

          <div className="flex justify-between items-center">
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSubmit}
                loading={updateMutation.isPending}
                disabled={!hasChanges}
              >
                Save Settings
              </Button>

              {hasWorkspaceConfig && (
                <Popconfirm
                  title="Remove SMTP settings"
                  description="This will revert to the global SMTP configuration (if available)."
                  onConfirm={() => deleteMutation.mutate()}
                  okText="Remove"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={deleteMutation.isPending}
                  >
                    Remove Custom SMTP
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </div>
        </Form>
      </div>

      {/* Test Email */}
      {status?.available && (
        <div>
          <Title level={5} className="!mb-4">
            Test Email Delivery
          </Title>
          <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
            <Paragraph type="secondary" className="!mb-4">
              Send a test email to verify your SMTP configuration is working correctly.
            </Paragraph>

            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="Enter test email address"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                type="email"
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleTestEmail}
                loading={testMutation.isPending}
              >
                Send Test
              </Button>
            </Space.Compact>
          </div>
        </div>
      )}

    </div>
  )
}
