# Track L: Frontend SMTP Settings Implementation Plan

**Track:** L - SMTP Settings
**Dependencies:** API contracts from Track B (SMTP/Mail)
**Blocks:** None (user-facing feature)

---

## Overview

This track implements the SMTP settings section where workspace owners can configure custom email delivery settings for invitations and notifications.

---

## Files to Create

```
console/src/components/settings/
└── SmtpSettings.tsx

console/src/types/
└── smtp.ts

console/src/lib/
└── api.ts (add smtp methods)
```

---

## Task 1: SMTP Types

**File:** `console/src/types/smtp.ts`

```typescript
export interface SmtpStatus {
  available: boolean;
  source: 'workspace' | 'global' | 'none';
  from_email?: string;
}

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string; // Will be masked in responses
  from_name: string;
  from_email: string;
}
```

---

## Task 2: API Client Updates

**File:** `console/src/lib/api.ts` (add to existing)

```typescript
import type { SmtpStatus, SmtpSettings } from '../types/smtp';

// Add to api object
export const api = {
  // ... existing methods

  smtp: {
    status: async (workspaceId: string): Promise<SmtpStatus> => {
      const res = await fetchWithAuth(`/api/smtp.status?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error('Failed to get SMTP status');
      return res.json();
    },

    get: async (workspaceId: string): Promise<SmtpSettings | null> => {
      const res = await fetchWithAuth(`/api/smtp.get?workspaceId=${workspaceId}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error('Failed to get SMTP settings');
      }
      return res.json();
    },

    update: async (workspaceId: string, settings: SmtpSettings): Promise<SmtpSettings> => {
      const res = await fetchWithAuth(`/api/smtp.update?workspaceId=${workspaceId}`, {
        method: 'POST',
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to update SMTP settings');
      }
      return res.json();
    },

    delete: async (workspaceId: string): Promise<void> => {
      const res = await fetchWithAuth(`/api/smtp.delete?workspaceId=${workspaceId}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to delete SMTP settings');
    },

    test: async (workspaceId: string, to: string): Promise<{ success: boolean; message: string }> => {
      const res = await fetchWithAuth(`/api/smtp.test?workspaceId=${workspaceId}`, {
        method: 'POST',
        body: JSON.stringify({ to }),
      });
      return res.json();
    },
  },
};
```

---

## Task 3: SMTP Settings Component

**File:** `console/src/components/settings/SmtpSettings.tsx`

```tsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Switch,
  Button,
  Alert,
  Typography,
  Divider,
  Space,
  Tag,
  Popconfirm,
  message,
  Spin,
  Result,
} from 'antd';
import {
  MailOutlined,
  SaveOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { api } from '../../lib/api';
import type { SmtpSettings as SmtpSettingsType, SmtpStatus } from '../../types/smtp';

const { Title, Text, Paragraph } = Typography;

interface SmtpSettingsProps {
  workspaceId: string;
  isOwner: boolean;
}

export function SmtpSettings({ workspaceId, isOwner }: SmtpSettingsProps) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [testEmail, setTestEmail] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch SMTP status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['smtp-status', workspaceId],
    queryFn: () => api.smtp.status(workspaceId),
  });

  // Fetch SMTP settings (owner only)
  const {
    data: settings,
    isLoading: settingsLoading,
  } = useQuery({
    queryKey: ['smtp-settings', workspaceId],
    queryFn: () => api.smtp.get(workspaceId),
    enabled: isOwner,
  });

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: (data: SmtpSettingsType) => api.smtp.update(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-status', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['smtp-settings', workspaceId] });
      message.success('SMTP settings saved');
      setHasChanges(false);
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Delete settings mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.smtp.delete(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-status', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['smtp-settings', workspaceId] });
      form.resetFields();
      message.success('SMTP settings removed');
      setHasChanges(false);
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Test email mutation
  const testMutation = useMutation({
    mutationFn: (to: string) => api.smtp.test(workspaceId, to),
    onSuccess: (result) => {
      if (result.success) {
        message.success('Test email sent successfully');
      } else {
        message.error(result.message);
      }
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Set form values when settings load
  useEffect(() => {
    if (settings) {
      form.setFieldsValue(settings);
    }
  }, [settings, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      updateMutation.mutate(values);
    } catch {
      // Form validation failed
    }
  };

  const handleValuesChange = () => {
    setHasChanges(true);
  };

  const handleTestEmail = () => {
    if (!testEmail) {
      message.warning('Please enter a test email address');
      return;
    }
    testMutation.mutate(testEmail);
  };

  // Non-owner view
  if (!isOwner) {
    return (
      <Card>
        <Result
          icon={<InfoCircleOutlined />}
          title="Owner Only"
          subTitle="Only the workspace owner can configure SMTP settings."
        />
      </Card>
    );
  }

  if (statusLoading || settingsLoading) {
    return (
      <Card>
        <div className="flex justify-center py-8">
          <Spin tip="Loading SMTP settings..." />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MailOutlined className="text-2xl text-gray-400" />
            <div>
              <Title level={5} className="!mb-0">
                Email Delivery Status
              </Title>
              <Text type="secondary">
                {status?.available
                  ? `Emails will be sent via ${status.source === 'workspace' ? 'custom' : 'global'} SMTP`
                  : 'Email delivery is not configured'}
              </Text>
            </div>
          </div>
          <div>
            {status?.available ? (
              <Tag color="success" icon={<CheckCircleOutlined />}>
                Configured
              </Tag>
            ) : (
              <Tag color="error" icon={<CloseCircleOutlined />}>
                Not Configured
              </Tag>
            )}
          </div>
        </div>

        {status?.source === 'global' && (
          <Alert
            type="info"
            message="Using Global SMTP"
            description={`Emails are being sent using the system's default SMTP configuration (${status.from_email}). You can configure custom SMTP settings below to use your own email server.`}
            showIcon
            className="mt-4"
          />
        )}
      </Card>

      {/* Settings Form */}
      <Card>
        <Title level={5} className="!mb-4">
          Custom SMTP Configuration
        </Title>

        <Paragraph type="secondary" className="!mb-6">
          Configure your own SMTP server for sending invitation and notification
          emails. This overrides the global SMTP configuration.
        </Paragraph>

        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleValuesChange}
          initialValues={{
            enabled: false,
            port: 587,
            tls: true,
          }}
        >
          <Form.Item
            name="enabled"
            label="Enable Custom SMTP"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Divider />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              name="host"
              label="SMTP Host"
              rules={[{ required: true, message: 'Please enter SMTP host' }]}
            >
              <Input placeholder="smtp.example.com" />
            </Form.Item>

            <Form.Item
              name="port"
              label="Port"
              rules={[{ required: true, message: 'Please enter port' }]}
            >
              <InputNumber
                min={1}
                max={65535}
                style={{ width: '100%' }}
                placeholder="587"
              />
            </Form.Item>
          </div>

          <Form.Item
            name="tls"
            label="Use TLS"
            valuePropName="checked"
            extra="Enable TLS/SSL encryption (recommended)"
          >
            <Switch />
          </Form.Item>

          <Divider>Authentication (Optional)</Divider>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              name="username"
              label="Username"
            >
              <Input placeholder="username or email" autoComplete="off" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              extra="Enter new password to update, or leave as ******** to keep existing"
            >
              <Input.Password placeholder="••••••••" autoComplete="new-password" />
            </Form.Item>
          </div>

          <Divider>Sender Information</Divider>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              name="from_name"
              label="From Name"
              rules={[{ required: true, message: 'Please enter from name' }]}
            >
              <Input placeholder="Staminads Analytics" />
            </Form.Item>

            <Form.Item
              name="from_email"
              label="From Email"
              rules={[
                { required: true, message: 'Please enter from email' },
                { type: 'email', message: 'Please enter a valid email' },
              ]}
            >
              <Input placeholder="noreply@example.com" />
            </Form.Item>
          </div>

          <Divider />

          <div className="flex justify-between items-center">
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSubmit}
                loading={updateMutation.isPending}
                disabled={!hasChanges}
              >
                Save Settings
              </Button>

              {settings?.enabled && (
                <Popconfirm
                  title="Remove SMTP settings"
                  description="This will revert to the global SMTP configuration (if available)."
                  onConfirm={() => deleteMutation.mutate()}
                  okText="Remove"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={deleteMutation.isPending}
                  >
                    Remove Custom SMTP
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </div>
        </Form>
      </Card>

      {/* Test Email */}
      {status?.available && (
        <Card>
          <Title level={5} className="!mb-4">
            Test Email Delivery
          </Title>

          <Paragraph type="secondary" className="!mb-4">
            Send a test email to verify your SMTP configuration is working correctly.
          </Paragraph>

          <Space.Compact style={{ width: '100%', maxWidth: 400 }}>
            <Input
              placeholder="Enter test email address"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              type="email"
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleTestEmail}
              loading={testMutation.isPending}
            >
              Send Test
            </Button>
          </Space.Compact>
        </Card>
      )}

      {/* Common SMTP Settings */}
      <Card>
        <Title level={5} className="!mb-4">
          Common SMTP Settings
        </Title>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Host</th>
                <th className="py-2 pr-4">Port</th>
                <th className="py-2">TLS</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2 pr-4">Gmail</td>
                <td className="py-2 pr-4"><code>smtp.gmail.com</code></td>
                <td className="py-2 pr-4">587</td>
                <td className="py-2">Yes</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">SendGrid</td>
                <td className="py-2 pr-4"><code>smtp.sendgrid.net</code></td>
                <td className="py-2 pr-4">587</td>
                <td className="py-2">Yes</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Mailgun</td>
                <td className="py-2 pr-4"><code>smtp.mailgun.org</code></td>
                <td className="py-2 pr-4">587</td>
                <td className="py-2">Yes</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Amazon SES</td>
                <td className="py-2 pr-4"><code>email-smtp.us-east-1.amazonaws.com</code></td>
                <td className="py-2 pr-4">587</td>
                <td className="py-2">Yes</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Postmark</td>
                <td className="py-2 pr-4"><code>smtp.postmarkapp.com</code></td>
                <td className="py-2 pr-4">587</td>
                <td className="py-2">Yes</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
```

---

## Task 4: Integration with Settings Page

Update the workspace settings page to include the SMTP section:

**File:** `console/src/routes/_authenticated/workspaces/$workspaceId/settings.tsx` (modify)

```tsx
// Add import
import { SmtpSettings } from '../../../../components/settings/SmtpSettings';

// In the settings tabs/sections, add:
{
  key: 'smtp',
  label: 'Email (SMTP)',
  children: <SmtpSettings workspaceId={workspaceId} isOwner={userRole === 'owner'} />,
}
```

---

## Deliverables Checklist

- [ ] `console/src/types/smtp.ts`
- [ ] `console/src/lib/api.ts` (smtp methods added)
- [ ] `console/src/components/settings/SmtpSettings.tsx`
- [ ] Settings page updated with SMTP section
- [ ] Status card shows current configuration
- [ ] Global vs workspace SMTP indicated
- [ ] Form validates all fields
- [ ] Password field handles masking
- [ ] TLS toggle works
- [ ] Save button disabled when no changes
- [ ] Remove button with confirmation
- [ ] Test email functionality
- [ ] Common providers reference table
- [ ] Owner-only access enforced

---

## Acceptance Criteria

1. SMTP status clearly shows if email is configured
2. Source indicator (workspace/global/none) displayed
3. Non-owners see appropriate message
4. Form captures all SMTP fields correctly
5. Port number validated as valid range
6. TLS toggle works correctly
7. Password masked as ******** when existing
8. Entering new password updates it
9. Save only enabled when changes made
10. Remove button requires confirmation
11. Test email validates address format
12. Test email reports success/failure
13. Common provider table shows correct settings
14. Global SMTP fallback message shown when applicable
