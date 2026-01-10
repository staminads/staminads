import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Form, Input, Button, message } from 'antd'
import { z } from 'zod'
import { api } from '../../../../lib/api'
import { useAuth } from '../../../../lib/useAuth'

const accountSearchSchema = z.object({
  section: z.enum(['profile', 'password', 'email']).optional().default('profile'),
})

type AccountSection = 'profile' | 'password' | 'email'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/account')({
  component: AccountPage,
  validateSearch: accountSearchSchema,
})

const menuItems: { key: AccountSection; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'password', label: 'Change Password' },
  { key: 'email', label: 'Change Email' },
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

  return (
    <div className="flex-1 p-6">
      <h1 className="hidden md:block text-2xl font-light text-gray-800 mb-6">Account</h1>

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
        </div>
      </div>
    </div>
  )
}
