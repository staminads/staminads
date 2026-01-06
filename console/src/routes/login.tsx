import { createFileRoute, useNavigate, redirect, Link } from '@tanstack/react-router'
import { Form, Input, Button, message } from 'antd'
import { useAuth } from '../lib/useAuth'
import { useEffect, useRef } from 'react'

type LoginSearch = {
  email?: string
  password?: string
  redirect?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    email: typeof search.email === 'string' ? search.email : undefined,
    password: typeof search.password === 'string' ? search.password : undefined,
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const { email, password, redirect: redirectTo } = Route.useSearch()
  const autoLoginAttempted = useRef(false)

  const handleLogin = async (emailVal: string, passwordVal: string) => {
    try {
      await login(emailVal, passwordVal)
      navigate({ to: redirectTo || '/' })
    } catch {
      message.error('Invalid credentials')
    }
  }

  const onFinish = (values: { email: string; password: string }) => {
    handleLogin(values.email, values.password)
  }

  // Auto-login if email and password are provided in URL params
  useEffect(() => {
    if (email && password && !autoLoginAttempted.current) {
      autoLoginAttempted.current = true
      form.setFieldsValue({ email, password })
      setTimeout(async () => {
        try {
          await login(email, password)
          navigate({ to: redirectTo || '/' })
        } catch {
          message.error('Invalid credentials')
        }
      }, 100)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password])

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: 'url(/background.jpg)',
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
        <img src="/logo.svg" alt="Staminads" className="h-8 mx-auto mb-8" />
        <Form form={form} onFinish={onFinish} layout="vertical">
          <Form.Item
            name="email"
            rules={[{ required: true, type: 'email', message: 'Valid email required' }]}
          >
            <Input placeholder="Email" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Password required' }]}
          >
            <Input.Password placeholder="Password" size="large" />
          </Form.Item>
          <Form.Item className="mb-0">
            <Button type="primary" htmlType="submit" block size="large">
              Sign in
            </Button>
          </Form.Item>

          <div className="text-center mt-4">
            <Link
              to="/forgot-password"
              className="text-sm text-purple-600 hover:text-purple-700"
            >
              Forgot your password?
            </Link>
          </div>
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
