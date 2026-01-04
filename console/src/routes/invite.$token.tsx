import { useState, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  Typography,
  Button,
  Form,
  Input,
  Alert,
  Spin,
  Result,
  Avatar,
  Tag,
  Divider,
} from 'antd'
import {
  UserOutlined,
  LockOutlined,
  TeamOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import { useAuth } from '../lib/useAuth'
import { api } from '../lib/api'
import type { InvitationDetails } from '../types/invitation'

const { Title, Text, Paragraph } = Typography

export const Route = createFileRoute('/invite/$token')({
  component: InviteAcceptPage,
})

function InviteAcceptPage() {
  const params = Route.useParams() as { token: string }
  const token = params.token
  const navigate = useNavigate()
  const { isAuthenticated, login } = useAuth()

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  // Fetch invitation details
  useEffect(() => {
    const fetchInvitation = async () => {
      try {
        const data = await api.invitations.get(token)
        setInvitation(data)

        // Check if expired
        if (new Date(data.expiresAt) < new Date()) {
          setExpired(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid invitation')
      } finally {
        setLoading(false)
      }
    }

    fetchInvitation()
  }, [token])

  // Fetch current user if authenticated
  useEffect(() => {
    const fetchCurrentUser = async () => {
      if (isAuthenticated) {
        try {
          const user = await api.auth.me()
          setCurrentUserEmail(user.email)
        } catch {
          // Ignore error
        }
      }
    }

    fetchCurrentUser()
  }, [isAuthenticated])

  // Handle new user registration
  const handleNewUserSubmit = async (values: {
    name: string
    password: string
    confirmPassword: string
  }) => {
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setAccepting(true)
    setError(null)

    try {
      const result = await api.invitations.accept({
        token,
        name: values.name,
        password: values.password,
      })

      // Auto-login after registration
      if (invitation) {
        await login(invitation.email, values.password)
      }

      navigate({ to: `/workspaces/${result.workspaceId}` } as any)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  // Handle existing user confirmation
  const handleExistingUserAccept = async () => {
    setAccepting(true)
    setError(null)

    try {
      const result = await api.invitations.accept({ token })
      navigate({ to: `/workspaces/${result.workspaceId}` } as any)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spin size="large" tip="Loading invitation..." />
      </div>
    )
  }

  // Error state
  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <Result
            status="error"
            title="Invalid Invitation"
            subTitle={error}
            extra={
              <a href="/login">
                <Button type="primary">Go to Login</Button>
              </a>
            }
          />
        </Card>
      </div>
    )
  }

  // Expired state
  if (expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <Result
            status="warning"
            title="Invitation Expired"
            subTitle="This invitation link has expired. Please contact the workspace administrator for a new invitation."
            extra={
              <a href="/login">
                <Button type="primary">Go to Login</Button>
              </a>
            }
          />
        </Card>
      </div>
    )
  }

  if (!invitation) return null

  const roleColors: Record<string, string> = {
    admin: 'purple',
    editor: 'blue',
    viewer: 'default',
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        {/* Workspace Info */}
        <div className="text-center mb-6">
          {invitation.workspace.logo_url ? (
            <Avatar
              src={invitation.workspace.logo_url}
              size={64}
              className="mb-4"
            />
          ) : (
            <Avatar
              size={64}
              icon={<TeamOutlined />}
              className="mb-4 bg-purple-500"
            />
          )}

          <Title level={3} className="!mb-1">
            Join {invitation.workspace.name}
          </Title>

          <div className="flex items-center justify-center gap-2 text-gray-500 mb-2">
            <GlobalOutlined />
            <Text type="secondary">{invitation.workspace.website}</Text>
          </div>

          <Tag color={roleColors[invitation.role]}>
            {invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
          </Tag>
        </div>

        <Divider />

        <Paragraph className="text-center text-gray-600 mb-6">
          <strong>{invitation.inviter.name}</strong> invited you to join this
          workspace as {invitation.role === 'admin' ? 'an' : 'a'}{' '}
          <strong>{invitation.role}</strong>.
        </Paragraph>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            className="mb-6"
            closable
            onClose={() => setError(null)}
          />
        )}

        {/* Existing User Flow */}
        {invitation.existingUser ? (
          <div>
            {isAuthenticated && currentUserEmail === invitation.email ? (
              // Logged in as correct user
              <div className="text-center">
                <Paragraph>
                  You're signed in as <strong>{currentUserEmail}</strong>
                </Paragraph>
                <Button
                  type="primary"
                  size="large"
                  block
                  loading={accepting}
                  onClick={handleExistingUserAccept}
                >
                  Accept Invitation
                </Button>
              </div>
            ) : isAuthenticated ? (
              // Logged in as different user
              <div className="text-center">
                <Alert
                  type="warning"
                  message="Email Mismatch"
                  description={`This invitation is for ${invitation.email}, but you're signed in as ${currentUserEmail}. Please log out and sign in with the correct account.`}
                  className="mb-4"
                />
                <Button
                  type="primary"
                  size="large"
                  block
                  onClick={() => navigate({ to: '/login' })}
                >
                  Sign in as {invitation.email}
                </Button>
              </div>
            ) : (
              // Not logged in
              <div className="text-center">
                <Paragraph>
                  You already have an account. Please sign in to accept this
                  invitation.
                </Paragraph>
                <a href={`/login?redirect=/invite/${token}`}>
                  <Button type="primary" size="large" block>
                    Sign in to Accept
                  </Button>
                </a>
              </div>
            )}
          </div>
        ) : (
          /* New User Registration Flow */
          <div>
            <Paragraph className="text-center mb-4">
              Create your account to join the workspace
            </Paragraph>

            <Form
              name="accept-invitation"
              onFinish={handleNewUserSubmit}
              layout="vertical"
              size="large"
            >
              <Form.Item label="Email">
                <Input
                  value={invitation.email}
                  disabled
                  prefix={<UserOutlined />}
                />
              </Form.Item>

              <Form.Item
                name="name"
                label="Your Name"
                rules={[
                  { required: true, message: 'Please enter your name' },
                  { min: 1, max: 100, message: 'Name must be 1-100 characters' },
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="Enter your full name"
                  autoComplete="name"
                />
              </Form.Item>

              <Form.Item
                name="password"
                label="Password"
                rules={[
                  { required: true, message: 'Please enter a password' },
                  { min: 8, message: 'Password must be at least 8 characters' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Create a password"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                rules={[
                  { required: true, message: 'Please confirm your password' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve()
                      }
                      return Promise.reject(new Error('Passwords do not match'))
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={accepting}
                >
                  Create Account & Join
                </Button>
              </Form.Item>
            </Form>
          </div>
        )}

        <Divider />

        <div className="text-center text-sm text-gray-500">
          <Text type="secondary">
            By joining, you agree to the workspace's terms and policies.
          </Text>
        </div>
      </Card>
    </div>
  )
}
