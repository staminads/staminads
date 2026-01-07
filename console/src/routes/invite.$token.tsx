import { useState, useEffect } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { Button, Form, Input, Spin, Avatar, Tag } from 'antd'
import { TeamOutlined, GlobalOutlined } from '@ant-design/icons'
import { useAuth } from '../lib/useAuth'
import { api } from '../lib/api'
import type { InvitationDetails } from '../types/invitation'

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: `/workspaces/${result.workspaceId}` } as any)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  const roleColors: Record<string, string> = {
    admin: 'purple',
    editor: 'blue',
    viewer: 'default',
  }

  const renderContent = () => {
    // Loading state
    if (loading) {
      return (
        <div className="text-center py-8">
          <Spin size="large" />
          <p className="mt-4 text-gray-600">Loading invitation...</p>
        </div>
      )
    }

    // Error state
    if (error && !invitation) {
      return (
        <div className="text-center">
          <p className="text-red-600 mb-6">{error}</p>
          <Link to="/login">
            <Button type="primary" block size="large">
              Go to sign in
            </Button>
          </Link>
        </div>
      )
    }

    // Expired state
    if (expired) {
      return (
        <div className="text-center">
          <p className="text-gray-600 mb-6">
            This invitation link has expired. Please contact the workspace administrator for a new invitation.
          </p>
          <Link to="/login">
            <Button type="primary" block size="large">
              Go to sign in
            </Button>
          </Link>
        </div>
      )
    }

    if (!invitation) return null

    return (
      <>
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

          <h2 className="text-xl font-semibold mb-1">
            Join {invitation.workspace.name}
          </h2>

          <div className="flex items-center justify-center gap-2 text-gray-500 mb-2">
            <GlobalOutlined />
            <span>{invitation.workspace.website}</span>
          </div>

          <Tag color={roleColors[invitation.role]}>
            {invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
          </Tag>
        </div>

        <div className="border-t border-gray-200 my-6" />

        <p className="text-center text-gray-600 mb-6">
          <strong>{invitation.inviter.name}</strong> invited you to join this
          workspace as {invitation.role === 'admin' ? 'an' : 'a'}{' '}
          <strong>{invitation.role}</strong>.
        </p>

        {/* Existing User Flow */}
        {invitation.existingUser ? (
          <div>
            {isAuthenticated && currentUserEmail === invitation.email ? (
              // Logged in as correct user
              <div className="text-center">
                <p className="text-gray-600 mb-4">
                  You're signed in as <strong>{currentUserEmail}</strong>
                </p>
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
                <p className="text-amber-600 mb-4">
                  This invitation is for {invitation.email}, but you're signed in as {currentUserEmail}. Please sign out and sign in with the correct account.
                </p>
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
                <p className="text-gray-600 mb-4">
                  You already have an account. Please sign in to accept this invitation.
                </p>
                <Link to="/login" search={{ redirect: `/invite/${token}` }}>
                  <Button type="primary" size="large" block>
                    Sign in to Accept
                  </Button>
                </Link>
              </div>
            )}
          </div>
        ) : (
          /* New User Registration Flow */
          <div>
            <p className="text-center text-gray-600 mb-4">
              Create your account to join the workspace
            </p>

            <Form
              name="accept-invitation"
              onFinish={handleNewUserSubmit}
              layout="vertical"
            >
              <Form.Item label="Email">
                <Input
                  value={invitation.email}
                  disabled
                  size="large"
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
                  placeholder="Enter your full name"
                  size="large"
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
                  placeholder="Create a password"
                  size="large"
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
                  placeholder="Confirm your password"
                  size="large"
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item className="mb-0">
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  size="large"
                  loading={accepting}
                >
                  Create Account & Join
                </Button>
              </Form.Item>
            </Form>
          </div>
        )}

        <div className="border-t border-gray-200 my-6" />

        <p className="text-center text-xs text-gray-500">
          By joining, you agree to the workspace's terms and policies.
        </p>
      </>
    )
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: 'url(/background.jpg)',
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
        <img src="/logo.svg" alt="Staminads" className="h-8 mx-auto mb-8" />
        {renderContent()}
      </div>

      {/* Photo credit */}
      <div className="absolute bottom-2 left-2 text-[10px] text-white/60">
        Photo by{' '}
        <a
          href="https://unsplash.com/fr/@rodlong?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
          className="underline hover:text-white/80"
          target="_blank"
          rel="noopener noreferrer"
        >
          Rod Long
        </a>
      </div>
    </div>
  )
}
