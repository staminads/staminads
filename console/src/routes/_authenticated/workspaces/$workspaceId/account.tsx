import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Form, Input, Button, message, Table, Tag, Popconfirm, Tooltip, Empty } from 'antd'
import { DeleteOutlined, EditOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { z } from 'zod'

dayjs.extend(relativeTime)
import { api } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'
import { SubscribeDrawer } from '../../../../components/subscriptions/SubscribeDrawer'
import type { Subscription } from '../../../../types/subscription'

const accountSearchSchema = z.object({
  section: z.enum(['profile', 'password', 'email', 'notifications']).optional().default('profile'),
})

type AccountSection = 'profile' | 'password' | 'email' | 'notifications'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/account')({
  component: AccountPage,
  validateSearch: accountSearchSchema,
})

const menuItems: { key: AccountSection; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'password', label: 'Change Password' },
  { key: 'email', label: 'Change Email' },
  { key: 'notifications', label: 'Notifications' },
]

function AccountPage() {
  const { workspaceId } = Route.useParams()
  const { section } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { logout } = useAuth()

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: api.auth.me,
  })

  // Subscriptions query
  const { data: subscriptions, isLoading: subscriptionsLoading, refetch: refetchSubscriptions } = useQuery({
    queryKey: ['subscriptions', workspaceId],
    queryFn: () => api.subscriptions.list(workspaceId),
    enabled: section === 'notifications',
  })

  // Edit subscription state
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null)

  const setActiveSection = (newSection: AccountSection) => {
    navigate({ to: '/workspaces/$workspaceId/account', params: { workspaceId }, search: { section: newSection } })
  }

  // Profile form
  const [profileForm] = Form.useForm()

  // Set form values when user data loads
  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({ name: user.name })
    }
  }, [user, profileForm])

  const updateProfileMutation = useMutation({
    mutationFn: api.auth.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] })
      message.success('Profile updated')
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to update profile')
    },
  })

  const onProfileSubmit = (values: { name: string }) => {
    updateProfileMutation.mutate({ name: values.name })
  }

  // Password form
  const [passwordForm] = Form.useForm()
  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      api.auth.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      message.success('Password changed. Please log in again.')
      logout()
      navigate({ to: '/login' })
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to change password')
    },
  })

  const onPasswordSubmit = (values: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('New passwords do not match')
      return
    }
    changePasswordMutation.mutate({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    })
  }

  // Email form
  const [emailForm] = Form.useForm()
  const updateEmailMutation = useMutation({
    mutationFn: api.auth.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] })
      message.success('Email updated')
      emailForm.resetFields(['newEmail'])
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to update email')
    },
  })

  const onEmailSubmit = (values: { newEmail: string }) => {
    updateEmailMutation.mutate({ email: values.newEmail })
  }

  // Subscription mutations
  const pauseSubscription = useMutation({
    mutationFn: (id: string) => api.subscriptions.pause(workspaceId, id),
    onSuccess: () => {
      message.success('Subscription paused')
      refetchSubscriptions()
    },
    onError: (error: Error) => message.error(error.message),
  })

  const resumeSubscription = useMutation({
    mutationFn: (id: string) => api.subscriptions.resume(workspaceId, id),
    onSuccess: () => {
      message.success('Subscription resumed')
      refetchSubscriptions()
    },
    onError: (error: Error) => message.error(error.message),
  })

  const deleteSubscription = useMutation({
    mutationFn: (id: string) => api.subscriptions.delete(workspaceId, id),
    onSuccess: () => {
      message.success('Subscription deleted')
      refetchSubscriptions()
    },
    onError: (error: Error) => message.error(error.message),
  })

  const sendNowSubscription = useMutation({
    mutationFn: (id: string) => api.subscriptions.sendNow(workspaceId, id),
    onSuccess: () => {
      message.success('Report sent!')
      refetchSubscriptions()
    },
    onError: (error: Error) => message.error(error.message),
  })

  // Profile section content
  const profileContent = (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
      <Form
        form={profileForm}
        layout="vertical"
        onFinish={onProfileSubmit}
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="Your name" />
        </Form.Item>
        <Form.Item className="mb-0">
          <Button
            type="primary"
            htmlType="submit"
            loading={updateProfileMutation.isPending}
          >
            Save
          </Button>
        </Form.Item>
      </Form>
    </div>
  )

  // Password section content
  const passwordContent = (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={onPasswordSubmit}
      >
        <Form.Item
          name="currentPassword"
          label="Current Password"
          rules={[{ required: true, message: 'Current password is required' }]}
        >
          <Input.Password placeholder="Enter current password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New Password"
          rules={[
            { required: true, message: 'New password is required' },
            { min: 8, message: 'Password must be at least 8 characters' },
          ]}
        >
          <Input.Password placeholder="Enter new password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="Confirm New Password"
          rules={[
            { required: true, message: 'Please confirm your new password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve()
                }
                return Promise.reject(new Error('Passwords do not match'))
              },
            }),
          ]}
        >
          <Input.Password placeholder="Confirm new password" />
        </Form.Item>
        <Form.Item className="mb-0">
          <Button
            type="primary"
            htmlType="submit"
            loading={changePasswordMutation.isPending}
          >
            Change Password
          </Button>
        </Form.Item>
      </Form>
    </div>
  )

  // Email section content
  const emailContent = (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-xl">
      <Form
        form={emailForm}
        layout="vertical"
        onFinish={onEmailSubmit}
      >
        <Form.Item label="Current Email">
          <Input value={user?.email || ''} disabled />
        </Form.Item>
        <Form.Item
          name="newEmail"
          label="New Email"
          rules={[
            { required: true, message: 'New email is required' },
            { type: 'email', message: 'Please enter a valid email' },
          ]}
        >
          <Input placeholder="Enter new email" />
        </Form.Item>
        <Form.Item className="mb-0">
          <Button
            type="primary"
            htmlType="submit"
            loading={updateEmailMutation.isPending}
          >
            Update Email
          </Button>
        </Form.Item>
      </Form>
    </div>
  )

  // Notifications section content
  const subscriptionColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Frequency',
      dataIndex: 'frequency',
      key: 'frequency',
      render: (frequency: string) => (
        <span className="capitalize">{frequency}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : status === 'paused' ? 'orange' : 'red'}>
          {status}
        </Tag>
      ),
    },
    {
      title: 'Last Sent',
      dataIndex: 'last_sent_at',
      key: 'last_sent_at',
      render: (date: string | undefined, record: Subscription) => {
        if (!date || record.last_send_status === 'pending') {
          return <span className="text-gray-400">Never</span>
        }
        if (record.last_send_status === 'failed') {
          return (
            <Tooltip title={record.last_error}>
              <span className="text-red-500">{dayjs(date).fromNow()}</span>
            </Tooltip>
          )
        }
        return <span>{dayjs(date).fromNow()}</span>
      },
    },
    {
      title: 'Next Send',
      dataIndex: 'next_send_at',
      key: 'next_send_at',
      render: (date: string | undefined) => {
        if (!date) return <span className="text-gray-400">-</span>
        return <span>{dayjs(date).fromNow()}</span>
      },
    },
    {
      title: '',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, record: Subscription) => (
        <div className="flex gap-1 items-center justify-end">
          {record.status === 'active' ? (
            <Popconfirm
              title="Pause subscription?"
              description="You will stop receiving email reports."
              onConfirm={() => pauseSubscription.mutate(record.id)}
              okText="Pause"
              cancelText="Cancel"
            >
              <Tooltip title="Pause">
                <Button
                  type="text"
                  size="small"
                  icon={<PauseCircleOutlined />}
                  loading={pauseSubscription.isPending}
                />
              </Tooltip>
            </Popconfirm>
          ) : record.status === 'paused' ? (
            <Popconfirm
              title="Resume subscription?"
              description="You will start receiving email reports again."
              onConfirm={() => resumeSubscription.mutate(record.id)}
              okText="Resume"
              cancelText="Cancel"
            >
              <Tooltip title="Resume">
                <Button
                  type="text"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  loading={resumeSubscription.isPending}
                />
              </Tooltip>
            </Popconfirm>
          ) : null}
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditingSubscription(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete subscription?"
            description="This action cannot be undone."
            onConfirm={() => deleteSubscription.mutate(record.id)}
            okText="Delete"
            cancelText="Cancel"
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                loading={deleteSubscription.isPending}
              />
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title="Send report now?"
            description="This will send the report immediately to your email."
            onConfirm={() => sendNowSubscription.mutate(record.id)}
            okText="Send"
            cancelText="Cancel"
          >
            <Button
              size="small"
              type="primary"
              ghost
              loading={sendNowSubscription.isPending}
            >
              Send Now
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

  const notificationsContent = (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-medium">Email Subscriptions</h2>
        <p className="text-sm text-gray-500">
          Manage your periodic email reports. Create new subscriptions from the Dashboard using the bell icon.
        </p>
      </div>
      {subscriptionsLoading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : !subscriptions || subscriptions.length === 0 ? (
        <Empty
          description="No subscriptions yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <p className="text-sm text-gray-500">
            Go to the Dashboard and click the bell icon to create your first subscription.
          </p>
        </Empty>
      ) : (
        <Table
          className="bg-white rounded-lg shadow-sm"
          columns={subscriptionColumns}
          dataSource={subscriptions}
          rowKey="id"
          pagination={false}
          scroll={{ x: true }}
        />
      )}
    </div>
  )

  return (
    <div className="flex-1 p-6">
      <h1 className="hidden md:block text-2xl font-light text-gray-800 mb-6">My Account</h1>

      <div className="flex gap-6">
        {/* Sidebar Menu */}
        <div className="hidden md:block w-56 flex-shrink-0">
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
          {/* Mobile section selector */}
          <div className="md:hidden mb-4">
            <select
              value={section}
              onChange={(e) => setActiveSection(e.target.value as AccountSection)}
              className="w-full p-2 border border-gray-300 rounded-md"
            >
              {menuItems.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {section === 'profile' && profileContent}
          {section === 'password' && passwordContent}
          {section === 'email' && emailContent}
          {section === 'notifications' && notificationsContent}
        </div>
      </div>

      {/* Edit subscription drawer */}
      <SubscribeDrawer
        open={!!editingSubscription}
        onClose={() => setEditingSubscription(null)}
        workspaceId={workspaceId}
        subscription={editingSubscription ?? undefined}
        filters={[]}
        timezone="UTC"
      />
    </div>
  )
}
