# Track K: Frontend API Keys Settings Implementation Plan

**Track:** K - API Keys Settings
**Dependencies:** API contracts from Track C (API Keys)
**Blocks:** None (user-facing feature)

---

## Overview

This track implements the API Keys settings section where workspace admins can create, view, and manage API keys for programmatic access.

---

## Files to Create

```
console/src/components/settings/
├── ApiKeysSettings.tsx
└── CreateApiKeyModal.tsx

console/src/types/
└── api-key.ts

console/src/lib/
└── api.ts (add apiKeys methods)
```

---

## Task 1: API Key Types

**File:** `console/src/types/api-key.ts`

```typescript
export type ApiScope =
  | 'analytics:write'
  | 'analytics:read'
  | 'workspace:read'
  | 'workspace:manage';

export const API_SCOPES: Record<ApiScope, string> = {
  'analytics:write': 'Send session and event data',
  'analytics:read': 'Query analytics data',
  'workspace:read': 'Read workspace info',
  'workspace:manage': 'Update workspace settings',
};

export interface ApiKey {
  id: string;
  key_prefix: string;
  user_id: string;
  workspace_id: string;
  name: string;
  description: string;
  scopes: ApiScope[];
  status: 'active' | 'revoked' | 'expired';
  expires_at: string | null;
  last_used_at: string | null;
  created_by: string;
  created_at: string;
}

export interface CreateApiKeyRequest {
  workspaceId: string;
  name: string;
  description?: string;
  scopes: ApiScope[];
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  id: string;
  key: string; // Full key, shown only once
  key_prefix: string;
  name: string;
  scopes: ApiScope[];
  created_at: string;
}
```

---

## Task 2: API Client Updates

**File:** `console/src/lib/api.ts` (add to existing)

```typescript
import type {
  ApiKey,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from '../types/api-key';

// Add to api object
export const api = {
  // ... existing methods

  apiKeys: {
    list: async (workspaceId: string): Promise<ApiKey[]> => {
      const res = await fetchWithAuth(`/api/apiKeys.list?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error('Failed to list API keys');
      return res.json();
    },

    get: async (id: string): Promise<ApiKey> => {
      const res = await fetchWithAuth(`/api/apiKeys.get?id=${id}`);
      if (!res.ok) throw new Error('Failed to get API key');
      return res.json();
    },

    create: async (data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> => {
      const res = await fetchWithAuth('/api/apiKeys.create', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create API key');
      }
      return res.json();
    },

    update: async (id: string, data: { name?: string; description?: string; scopes?: string[] }): Promise<ApiKey> => {
      const res = await fetchWithAuth(`/api/apiKeys.update?id=${id}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update API key');
      return res.json();
    },

    revoke: async (id: string): Promise<void> => {
      const res = await fetchWithAuth(`/api/apiKeys.revoke?id=${id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to revoke API key');
    },

    rotate: async (id: string): Promise<CreateApiKeyResponse> => {
      const res = await fetchWithAuth(`/api/apiKeys.rotate?id=${id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to rotate API key');
      return res.json();
    },
  },
};
```

---

## Task 3: API Keys Settings Component

**File:** `console/src/components/settings/ApiKeysSettings.tsx`

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Popconfirm,
  message,
  Typography,
  Empty,
  Tooltip,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  ReloadOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { api } from '../../lib/api';
import { CreateApiKeyModal } from './CreateApiKeyModal';
import type { ApiKey, ApiScope, API_SCOPES } from '../../types/api-key';

const { Title, Text, Paragraph } = Typography;

interface ApiKeysSettingsProps {
  workspaceId: string;
}

const scopeColors: Record<string, string> = {
  'analytics:write': 'green',
  'analytics:read': 'blue',
  'workspace:read': 'orange',
  'workspace:manage': 'purple',
};

export function ApiKeysSettings({ workspaceId }: ApiKeysSettingsProps) {
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Fetch API keys
  const {
    data: apiKeys = [],
    isLoading,
  } = useQuery({
    queryKey: ['apiKeys', workspaceId],
    queryFn: () => api.apiKeys.list(workspaceId),
  });

  // Revoke mutation
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.apiKeys.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', workspaceId] });
      message.success('API key revoked');
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Rotate mutation
  const rotateMutation = useMutation({
    mutationFn: (id: string) => api.apiKeys.rotate(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', workspaceId] });
      setNewKey(data.key);
      message.success('API key rotated');
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  const handleCopyKey = async (key: string, id: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKeyId(id);
      message.success('Copied to clipboard');
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      message.error('Failed to copy');
    }
  };

  const handleCreateSuccess = (key: string) => {
    setCreateModalOpen(false);
    setNewKey(key);
    queryClient.invalidateQueries({ queryKey: ['apiKeys', workspaceId] });
  };

  const columns = [
    {
      title: 'Name',
      key: 'name',
      render: (_: unknown, record: ApiKey) => (
        <div>
          <div className="flex items-center gap-2">
            <KeyOutlined className="text-gray-400" />
            <span className="font-medium">{record.name}</span>
          </div>
          {record.description && (
            <div className="text-gray-500 text-sm mt-1">
              {record.description}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Key',
      key: 'key_prefix',
      width: 180,
      render: (_: unknown, record: ApiKey) => (
        <code className="bg-gray-100 px-2 py-1 rounded text-sm">
          {record.key_prefix}...
        </code>
      ),
    },
    {
      title: 'Scopes',
      key: 'scopes',
      width: 200,
      render: (_: unknown, record: ApiKey) => (
        <Space wrap>
          {record.scopes.map((scope) => (
            <Tag key={scope} color={scopeColors[scope]} className="text-xs">
              {scope}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Last Used',
      key: 'last_used_at',
      width: 120,
      render: (_: unknown, record: ApiKey) => (
        <Text type="secondary">
          {record.last_used_at
            ? new Date(record.last_used_at).toLocaleDateString()
            : 'Never'}
        </Text>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: unknown, record: ApiKey) => {
        if (record.status === 'revoked') {
          return <Badge status="error" text="Revoked" />;
        }
        if (record.expires_at && new Date(record.expires_at) < new Date()) {
          return <Badge status="warning" text="Expired" />;
        }
        return <Badge status="success" text="Active" />;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: ApiKey) => (
        <Space>
          <Popconfirm
            title="Rotate API key"
            description="This will revoke the current key and create a new one. Any applications using this key will stop working."
            onConfirm={() => rotateMutation.mutate(record.id)}
            okText="Rotate"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Rotate key">
              <Button
                type="text"
                icon={<ReloadOutlined />}
                size="small"
                loading={rotateMutation.isPending}
              />
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title="Revoke API key"
            description="This action cannot be undone. Any applications using this key will stop working."
            onConfirm={() => revokeMutation.mutate(record.id)}
            okText="Revoke"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Revoke key">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                size="small"
                loading={revokeMutation.isPending}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const activeKeys = apiKeys.filter((k) => k.status === 'active');

  return (
    <div className="space-y-6">
      {/* New Key Display */}
      {newKey && (
        <Card className="border-green-200 bg-green-50">
          <div className="flex items-start gap-4">
            <CheckCircleOutlined className="text-green-500 text-xl mt-1" />
            <div className="flex-1">
              <Title level={5} className="!mb-2 text-green-700">
                API Key Created
              </Title>
              <Paragraph className="!mb-2 text-green-700">
                Copy this key now. You won't be able to see it again.
              </Paragraph>
              <div className="flex items-center gap-2 bg-white p-3 rounded border">
                <code className="flex-1 font-mono text-sm break-all">
                  {newKey}
                </code>
                <Button
                  type="primary"
                  icon={copiedKeyId === 'new' ? <CheckCircleOutlined /> : <CopyOutlined />}
                  onClick={() => handleCopyKey(newKey, 'new')}
                >
                  {copiedKeyId === 'new' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Button
                type="link"
                className="!p-0 mt-2"
                onClick={() => setNewKey(null)}
              >
                I've copied the key
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* API Keys List */}
      <Card>
        <div className="flex justify-between items-center mb-4">
          <div>
            <Title level={5} className="!mb-1">
              API Keys ({activeKeys.length})
            </Title>
            <Text type="secondary">
              Use API keys to authenticate programmatic access to this workspace
            </Text>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            Create API Key
          </Button>
        </div>

        {apiKeys.length > 0 ? (
          <Table
            dataSource={activeKeys}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={false}
            size="middle"
          />
        ) : (
          <Empty
            description="No API keys yet"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
            >
              Create your first API key
            </Button>
          </Empty>
        )}
      </Card>

      {/* Usage Info */}
      <Card>
        <Title level={5} className="!mb-3">
          Using API Keys
        </Title>
        <Paragraph type="secondary">
          Include your API key in the <code>Authorization</code> header:
        </Paragraph>
        <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
          {`curl -X POST https://api.staminads.com/api/events \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"event": "pageview", "url": "https://example.com"}'`}
        </pre>
      </Card>

      {/* Create Modal */}
      <CreateApiKeyModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        workspaceId={workspaceId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
```

---

## Task 4: Create API Key Modal

**File:** `console/src/components/settings/CreateApiKeyModal.tsx`

```tsx
import { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Checkbox,
  Button,
  Alert,
  DatePicker,
  Typography,
} from 'antd';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { API_SCOPES, type ApiScope } from '../../types/api-key';

const { Text } = Typography;
const { TextArea } = Input;

interface CreateApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onSuccess: (key: string) => void;
}

const scopeOptions = Object.entries(API_SCOPES).map(([value, description]) => ({
  value,
  label: value,
  description,
}));

export function CreateApiKeyModal({
  open,
  onClose,
  workspaceId,
  onSuccess,
}: CreateApiKeyModalProps) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      scopes: ApiScope[];
      expiresAt?: string;
    }) =>
      api.apiKeys.create({
        workspaceId,
        ...data,
      }),
    onSuccess: (response) => {
      form.resetFields();
      setError(null);
      onSuccess(response.key);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      createMutation.mutate({
        name: values.name,
        description: values.description,
        scopes: values.scopes,
        expiresAt: values.expiresAt?.toISOString(),
      });
    } catch {
      // Form validation failed
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setError(null);
    onClose();
  };

  return (
    <Modal
      title="Create API Key"
      open={open}
      onCancel={handleCancel}
      width={500}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={createMutation.isPending}
          onClick={handleSubmit}
        >
          Create Key
        </Button>,
      ]}
    >
      {error && (
        <Alert
          message={error}
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
        initialValues={{
          scopes: ['analytics:read'],
        }}
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[
            { required: true, message: 'Please enter a name' },
            { max: 100, message: 'Name must be at most 100 characters' },
          ]}
        >
          <Input placeholder="e.g., Production SDK" />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
          rules={[
            { max: 500, message: 'Description must be at most 500 characters' },
          ]}
        >
          <TextArea
            rows={2}
            placeholder="Optional description for this key"
          />
        </Form.Item>

        <Form.Item
          name="scopes"
          label="Permissions"
          rules={[
            { required: true, message: 'Select at least one permission' },
          ]}
        >
          <Checkbox.Group className="flex flex-col gap-2">
            {scopeOptions.map((scope) => (
              <Checkbox key={scope.value} value={scope.value}>
                <div>
                  <code className="text-sm">{scope.label}</code>
                  <Text type="secondary" className="ml-2 text-sm">
                    - {scope.description}
                  </Text>
                </div>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Form.Item>

        <Form.Item
          name="expiresAt"
          label="Expiration (optional)"
          extra="Leave empty for no expiration"
        >
          <DatePicker
            showTime
            placeholder="Select expiration date"
            style={{ width: '100%' }}
            disabledDate={(current) => current && current.valueOf() < Date.now()}
          />
        </Form.Item>
      </Form>

      <Alert
        type="warning"
        message="The API key will only be shown once after creation"
        description="Make sure to copy and store it securely. You won't be able to see it again."
        showIcon
      />
    </Modal>
  );
}
```

---

## Task 5: Integration with Settings Page

Update the workspace settings page to include the API Keys section:

**File:** `console/src/routes/_authenticated/workspaces/$workspaceId/settings.tsx` (modify)

```tsx
// Add import
import { ApiKeysSettings } from '../../../../components/settings/ApiKeysSettings';

// In the settings tabs/sections, add:
{
  key: 'api-keys',
  label: 'API Keys',
  children: <ApiKeysSettings workspaceId={workspaceId} />,
}
```

---

## Deliverables Checklist

- [ ] `console/src/types/api-key.ts`
- [ ] `console/src/lib/api.ts` (apiKeys methods added)
- [ ] `console/src/components/settings/ApiKeysSettings.tsx`
- [ ] `console/src/components/settings/CreateApiKeyModal.tsx`
- [ ] Settings page updated with API Keys section
- [ ] API key list displays correctly
- [ ] Key prefix shown (not full key)
- [ ] Scopes displayed as tags
- [ ] Last used timestamp shown
- [ ] Create modal validates input
- [ ] New key shown only once with copy button
- [ ] Rotate key works with confirmation
- [ ] Revoke key works with confirmation
- [ ] Usage example displayed

---

## Acceptance Criteria

1. API keys listed with name, prefix, scopes, last used
2. Active/expired/revoked status shown correctly
3. Create modal captures name, description, scopes
4. At least one scope required
5. Optional expiration date supported
6. New key displayed prominently after creation
7. Copy button works correctly
8. Warning shown about one-time display
9. Rotate key shows confirmation
10. Rotate replaces key and shows new one
11. Revoke shows confirmation
12. Revoked keys no longer shown in main list
13. Usage example shows correct API format
