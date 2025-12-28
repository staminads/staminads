import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Form, Input, Button, message, Avatar } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { nanoid } from 'nanoid'

export const Route = createFileRoute('/_authenticated/workspaces/new')({
  component: NewWorkspaceForm,
})

function NewWorkspaceForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [detectingLogo, setDetectingLogo] = useState(false)

  const mutation = useMutation({
    mutationFn: api.workspaces.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      message.success('Workspace created')
      navigate({ to: '/' })
    },
    onError: () => message.error('Failed to create workspace'),
  })

  const onFinish = (values: { name: string; website: string; logo_url?: string }) => {
    mutation.mutate({
      id: nanoid(),
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
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  const onValuesChange = (changedValues: { website?: string }) => {
    if (changedValues.website && isValidUrl(changedValues.website)) {
      detectLogo(changedValues.website)
    }
  }

  const logoUrl = Form.useWatch('logo_url', form)

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-sm">
        <h2 className="text-2xl font-light text-center mb-8 text-gray-800">
          New Workspace
        </h2>

        <Form form={form} layout="vertical" onFinish={onFinish} onValuesChange={onValuesChange}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="My Website" size="large" />
          </Form.Item>

          <Form.Item
            name="website"
            label="Website"
            rules={[
              { required: true, message: 'Website is required' },
              { type: 'url', message: 'Must be a valid URL' }
            ]}
          >
            <Input placeholder="https://example.com" size="large" />
          </Form.Item>

          <Form.Item
            name="logo_url"
            label="Logo URL"
          >
            <Input
              placeholder="https://example.com/logo.png"
              size="large"
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
              size="large"
            >
              Create Workspace
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
