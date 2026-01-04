import { useState } from 'react'
import { Modal, Form, Input, Select, Button, Alert } from 'antd'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'

interface InviteMemberModalProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  onSuccess: () => void
}

const roleOptions = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Can manage settings, members, and integrations',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Can view analytics, create filters and annotations',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Can only view dashboards and analytics',
  },
]

export function InviteMemberModal({
  open,
  onClose,
  workspaceId,
  onSuccess,
}: InviteMemberModalProps) {
  const [form] = Form.useForm()
  const [error, setError] = useState<string | null>(null)

  const inviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.invitations.create(workspaceId, email, role as 'admin' | 'editor' | 'viewer'),
    onSuccess: () => {
      form.resetFields()
      setError(null)
      onSuccess()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      inviteMutation.mutate(values)
    } catch {
      // Form validation failed
    }
  }

  const handleCancel = () => {
    form.resetFields()
    setError(null)
    onClose()
  }

  return (
    <Modal
      title="Invite Team Member"
      open={open}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={inviteMutation.isPending}
          onClick={handleSubmit}
        >
          Send Invitation
        </Button>,
      ]}
    >
      {error && (
        <Alert
          title={error}
          type="error"
          showIcon
          className="mb-4"
          closable
          onClose={() => setError(null)}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={{ role: 'editor' }}
      >
        <Form.Item
          name="email"
          label="Email Address"
          rules={[
            { required: true, message: 'Please enter an email address' },
            { type: 'email', message: 'Please enter a valid email' },
          ]}
        >
          <Input
            placeholder="colleague@company.com"
            autoComplete="email"
          />
        </Form.Item>

        <Form.Item
          name="role"
          label="Role"
          rules={[{ required: true, message: 'Please select a role' }]}
        >
          <Select
            options={roleOptions.map((opt) => ({
              value: opt.value,
              label: (
                <div>
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.description}</div>
                </div>
              ),
            }))}
            optionLabelProp="value"
          />
        </Form.Item>
      </Form>

      <div className="text-sm text-gray-500 mt-4">
        An invitation email will be sent to this address. The invitation expires
        in 7 days.
      </div>
    </Modal>
  )
}
