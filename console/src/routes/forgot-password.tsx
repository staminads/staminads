import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { Form, Input, Button, message } from 'antd'
import { api } from '../lib/api'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const onFinish = async (values: { email: string }) => {
    setLoading(true)

    try {
      await api.auth.forgotPassword(values.email)
      setSuccess(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
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
        <img src="/logo.svg" alt="Staminads" className="h-8 mx-auto mb-8" />

        {success ? (
          <div className="text-center">
            <p className="text-gray-600 mb-6">
              If an account exists with that email, we've sent password reset instructions.
            </p>
            <Link to="/login">
              <Button type="primary" block size="large">
                Back to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <Form onFinish={onFinish} layout="vertical">
            <p className="text-center text-gray-600 mb-6">
              Enter your email and we'll send you a reset link
            </p>

            <Form.Item
              name="email"
              rules={[
                { required: true, message: 'Please enter your email' },
                { type: 'email', message: 'Please enter a valid email' },
              ]}
            >
              <Input placeholder="Email" size="large" autoComplete="email" />
            </Form.Item>

            <Form.Item className="mb-0">
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                Send reset link
              </Button>
            </Form.Item>

            <div className="text-center mt-4">
              <Link
                to="/login"
                className="text-sm text-purple-600 hover:text-purple-700"
              >
                Back to sign in
              </Link>
            </div>
          </Form>
        )}
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
