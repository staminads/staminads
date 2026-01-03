import { useState, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Form, Input, Button, message, Avatar } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'

const toSnakeCase = (str: string) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

export const Route = createFileRoute('/_authenticated/workspaces/new')({
  component: NewWorkspaceForm,
})

function NewWorkspaceForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [detectingLogo, setDetectingLogo] = useState(false)
  const logoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mutation = useMutation({
    mutationFn: api.workspaces.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      message.success('Workspace created')
      navigate({ to: '/workspaces/$workspaceId/install-sdk', params: { workspaceId: data.id } })
    },
    onError: () => message.error('Failed to create workspace'),
  })

  const onFinish = (values: { id: string; name: string; website: string; logo_url?: string }) => {
    mutation.mutate({
      ...values,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      currency: 'USD',
    })
  }

  const detectLogo = async (url?: string) => {
    const website = url || form.getFieldValue('website')
    if (!website) {
      message.warning('Please enter a website URL first')
      return
    }

    try {
      setDetectingLogo(true)
      const meta = await api.tools.websiteMeta(website)
      if (meta.logo_url) {
        form.setFieldValue('logo_url', meta.logo_url)
        message.success('Logo detected')
      } else {
        message.info('No logo found for this website')
      }
    } catch {
      message.error('Failed to detect logo')
    } finally {
      setDetectingLogo(false)
    }
  }

  const isValidUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      const parts = parsed.hostname.split('.')
      // If starts with www, require 3 parts (www.example.com), otherwise 2 (example.com)
      const minParts = parts[0] === 'www' ? 3 : 2
      return parts.length >= minParts && parts[parts.length - 1].length >= 2
    } catch {
      return false
    }
  }

  const onValuesChange = (changedValues: { name?: string; website?: string }) => {
    if (changedValues.name !== undefined) {
      form.setFieldValue('id', toSnakeCase(changedValues.name))
    }
    if (changedValues.website !== undefined) {
      if (logoDebounceRef.current) {
        clearTimeout(logoDebounceRef.current)
      }
      if (isValidUrl(changedValues.website)) {
        logoDebounceRef.current = setTimeout(() => {
          detectLogo(changedValues.website)
        }, 800)
      }
    }
  }

  const logoUrl = Form.useWatch('logo_url', form)

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-md">
        <h2 className="text-2xl font-light text-center mb-8 text-gray-800">
          New Workspace
        </h2>

        <Form form={form} layout="vertical" onFinish={onFinish} onValuesChange={onValuesChange}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="My Website" />
          </Form.Item>

          <Form.Item
            name="id"
            label="ID"
            rules={[
              { required: true, message: 'ID is required' },
              { pattern: /^[a-z][a-z0-9_]*$/, message: 'Must start with a letter and contain only lowercase letters, numbers, and underscores' },
            ]}
          >
            <Input placeholder="my_website" />
          </Form.Item>

          <Form.Item
            name="website"
            label="Website"
            rules={[
              { required: true, message: 'Website is required' },
              { type: 'url', message: 'Must be a valid URL' }
            ]}
          >
            <Input placeholder="https://example.com" />
          </Form.Item>

          <Form.Item
            name="logo_url"
            label="Logo URL"
          >
            <Input
              placeholder="https://example.com/logo.png"
              suffix={
                <Button
                  type="link"
                  size="small"
                  icon={<SearchOutlined />}
                  loading={detectingLogo}
                  onClick={() => detectLogo()}
                  className="!p-0 !h-auto"
                >
                  Detect
                </Button>
              }
              prefix={
                logoUrl ? (
                  <Avatar src={logoUrl} size="small" shape="square" className="mr-1" />
                ) : null
              }
            />
          </Form.Item>

          <Form.Item className="mb-0">
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              block
            >
              Create Workspace
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
