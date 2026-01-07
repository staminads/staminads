import { createFileRoute, redirect } from '@tanstack/react-router'
import { Form, Input, Button, message } from 'antd'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    try {
      const res = await fetch('/api/setup.status')
      if (res.ok) {
        const { setupCompleted } = await res.json()
        if (setupCompleted) {
          throw redirect({ to: '/login' })
        }
      }
    } catch (e) {
      // If we can't check status, allow access to setup page
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (e instanceof Response || (e as any)?.to === '/login') {
        throw e
      }
    }
  },
  component: SetupPage,
})

interface SetupFormValues {
  email: string
  name: string
  password: string
  confirmPassword: string
}

function SetupPage() {
  const [form] = Form.useForm<SetupFormValues>()

  const onFinish = async (values: SetupFormValues) => {
    try {
      const res = await fetch('/api/setup.initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.email,
          name: values.name,
          password: values.password,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        message.error(error.message || 'Failed to create admin account')
        return
      }

      const { access_token, user } = await res.json()

      // Store auth data
      localStorage.setItem('token', access_token)
      localStorage.setItem(
        'user',
        JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.is_super_admin,
        })
      )

      message.success('Admin account created successfully')

      // Reload page to pick up new auth state
      window.location.href = '/'
    } catch {
      message.error('Failed to create admin account')
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: 'url(/background.jpg)',
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
        <img src="/logo.svg" alt="Staminads" className="h-8 mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-center text-gray-800 mb-2">
          Welcome to Staminads
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          Create your admin account to get started
        </p>
        <Form form={form} onFinish={onFinish} layout="vertical">
          <Form.Item
            name="name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="Your name" size="large" />
          </Form.Item>
          <Form.Item
            name="email"
            rules={[
              { required: true, type: 'email', message: 'Valid email required' },
            ]}
          >
            <Input placeholder="Email" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Password required' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password placeholder="Password" size="large" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
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
            <Input.Password placeholder="Confirm password" size="large" />
          </Form.Item>
          <Form.Item className="mb-0">
            <Button type="primary" htmlType="submit" block size="large">
              Create Admin Account
            </Button>
          </Form.Item>
        </Form>
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
