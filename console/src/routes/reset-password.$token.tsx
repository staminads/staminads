import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { Form, Input, Button, message, Result } from 'antd'
import { api } from '../lib/api'

export const Route = createFileRoute('/reset-password/$token')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = useParams({ from: '/reset-password/$token' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const onFinish = async (values: { password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      await api.auth.resetPassword(token, values.password)
      setSuccess(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Password reset failed')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
        style={{
          backgroundImage: 'url(/background.jpg)',
        }}
      >
        <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
          <Result
            status="success"
            title="Password reset successful"
            subTitle="Your password has been updated. You can now sign in with your new password."
            extra={
              <Link to="/login">
                <Button type="primary">Sign in</Button>
              </Link>
            }
          />
        </div>

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

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: 'url(/background.jpg)',
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
        <img src="/logo.svg" alt="Staminads" className="h-8 mx-auto mb-8" />
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Please enter a password' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password placeholder="New password" size="large" autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
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
            <Input.Password placeholder="Confirm password" size="large" autoComplete="new-password" />
          </Form.Item>

          <Form.Item className="mb-0">
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Reset password
            </Button>
          </Form.Item>

          <div className="text-center mt-4">
            <Link to="/login" className="text-sm text-purple-600 hover:text-purple-700">
              Back to sign in
            </Link>
          </div>
        </Form>
      </div>

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
