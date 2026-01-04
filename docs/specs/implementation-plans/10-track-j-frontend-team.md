# Track J: Frontend Team Settings Implementation Plan

**Track:** J - Team Settings
**Dependencies:** API contracts from Tracks D (Invitations), E (Members)
**Blocks:** None (user-facing feature)

---

## Overview

This track implements the Team Settings section in workspace settings, allowing admins to manage members, change roles, and send/manage invitations.

---

## Files to Create

```
console/src/components/settings/
├── TeamSettings.tsx
└── InviteMemberModal.tsx

console/src/types/
└── member.ts

console/src/lib/
└── api.ts (add members methods)
```

---

## Task 1: Member Types

**File:** `console/src/types/member.ts`

```typescript
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Member {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
}

export interface Invitation {
  id: string;
  workspace_id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
  inviter: {
    id: string;
    name: string;
    email: string;
  };
}
```

---

## Task 2: API Client Updates

**File:** `console/src/lib/api.ts` (add to existing)

```typescript
import type { Member, Invitation, Role } from '../types/member';

// Add to api object
export const api = {
  // ... existing methods

  members: {
    list: async (workspaceId: string): Promise<Member[]> => {
      const res = await fetchWithAuth(`/api/members.list?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error('Failed to list members');
      return res.json();
    },

    updateRole: async (
      workspaceId: string,
      userId: string,
      role: Exclude<Role, 'owner'>
    ): Promise<Member> => {
      const res = await fetchWithAuth('/api/members.updateRole', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, userId, role }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to update role');
      }
      return res.json();
    },

    remove: async (workspaceId: string, userId: string): Promise<void> => {
      const res = await fetchWithAuth(
        `/api/members.remove?workspaceId=${workspaceId}&userId=${userId}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to remove member');
      }
    },

    leave: async (workspaceId: string): Promise<void> => {
      const res = await fetchWithAuth(
        `/api/members.leave?workspaceId=${workspaceId}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to leave workspace');
      }
    },

    transferOwnership: async (
      workspaceId: string,
      newOwnerId: string
    ): Promise<void> => {
      const res = await fetchWithAuth('/api/members.transferOwnership', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, newOwnerId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to transfer ownership');
      }
    },
  },
};
```

---

## Task 3: Team Settings Component

**File:** `console/src/components/settings/TeamSettings.tsx`

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Tag,
  Select,
  Space,
  Popconfirm,
  message,
  Typography,
  Divider,
  Empty,
  Tooltip,
  Avatar,
} from 'antd';
import {
  UserAddOutlined,
  DeleteOutlined,
  CrownOutlined,
  MailOutlined,
  ReloadOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { InviteMemberModal } from './InviteMemberModal';
import type { Member, Invitation, Role } from '../../types/member';

const { Title, Text } = Typography;

interface TeamSettingsProps {
  workspaceId: string;
  userRole: Role;
}

const roleColors: Record<Role, string> = {
  owner: 'gold',
  admin: 'purple',
  editor: 'blue',
  viewer: 'default',
};

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

export function TeamSettings({ workspaceId, userRole }: TeamSettingsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const canManageMembers = userRole === 'owner' || userRole === 'admin';

  // Fetch members
  const {
    data: members = [],
    isLoading: membersLoading,
  } = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api.members.list(workspaceId),
  });

  // Fetch pending invitations
  const {
    data: invitations = [],
    isLoading: invitationsLoading,
  } = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => api.invitations.list(workspaceId),
    enabled: canManageMembers,
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<Role, 'owner'> }) =>
      api.members.updateRole(workspaceId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
      message.success('Role updated');
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.members.remove(workspaceId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
      message.success('Member removed');
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Revoke invitation mutation
  const revokeInvitationMutation = useMutation({
    mutationFn: (id: string) => api.invitations.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
      message.success('Invitation revoked');
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Resend invitation mutation
  const resendInvitationMutation = useMutation({
    mutationFn: (id: string) => api.invitations.resend(id),
    onSuccess: () => {
      message.success('Invitation resent');
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // Member columns
  const memberColumns = [
    {
      title: 'Member',
      key: 'member',
      render: (_: unknown, record: Member) => (
        <Space>
          <Avatar size="small">
            {record.user.name.charAt(0).toUpperCase()}
          </Avatar>
          <div>
            <div className="font-medium">{record.user.name}</div>
            <div className="text-gray-500 text-sm">{record.user.email}</div>
          </div>
        </Space>
      ),
    },
    {
      title: 'Role',
      key: 'role',
      width: 150,
      render: (_: unknown, record: Member) => {
        const isCurrentUser = record.user_id === user?.id;
        const canChangeRole =
          canManageMembers &&
          record.role !== 'owner' &&
          !isCurrentUser &&
          (userRole === 'owner' || record.role !== 'admin');

        if (record.role === 'owner') {
          return (
            <Tag color={roleColors.owner} icon={<CrownOutlined />}>
              Owner
            </Tag>
          );
        }

        if (canChangeRole) {
          return (
            <Select
              value={record.role}
              options={roleOptions}
              size="small"
              style={{ width: 100 }}
              loading={updateRoleMutation.isPending}
              onChange={(role) =>
                updateRoleMutation.mutate({
                  userId: record.user_id,
                  role: role as Exclude<Role, 'owner'>,
                })
              }
            />
          );
        }

        return (
          <Tag color={roleColors[record.role]}>
            {record.role.charAt(0).toUpperCase() + record.role.slice(1)}
          </Tag>
        );
      },
    },
    {
      title: 'Joined',
      key: 'joined_at',
      width: 120,
      render: (_: unknown, record: Member) => (
        <Text type="secondary">
          {new Date(record.joined_at).toLocaleDateString()}
        </Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: Member) => {
        const isCurrentUser = record.user_id === user?.id;
        const canRemove =
          canManageMembers &&
          record.role !== 'owner' &&
          !isCurrentUser &&
          (userRole === 'owner' || record.role !== 'admin');

        if (!canRemove) return null;

        return (
          <Popconfirm
            title="Remove member"
            description={`Are you sure you want to remove ${record.user.name}?`}
            onConfirm={() => removeMemberMutation.mutate(record.user_id)}
            okText="Remove"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Remove member">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                size="small"
                loading={removeMemberMutation.isPending}
              />
            </Tooltip>
          </Popconfirm>
        );
      },
    },
  ];

  // Invitation columns
  const invitationColumns = [
    {
      title: 'Email',
      key: 'email',
      render: (_: unknown, record: Invitation) => (
        <Space>
          <MailOutlined className="text-gray-400" />
          <span>{record.email}</span>
        </Space>
      ),
    },
    {
      title: 'Role',
      key: 'role',
      width: 100,
      render: (_: unknown, record: Invitation) => (
        <Tag color={roleColors[record.role]}>
          {record.role.charAt(0).toUpperCase() + record.role.slice(1)}
        </Tag>
      ),
    },
    {
      title: 'Invited by',
      key: 'inviter',
      width: 150,
      render: (_: unknown, record: Invitation) => (
        <Text type="secondary">{record.inviter.name}</Text>
      ),
    },
    {
      title: 'Expires',
      key: 'expires_at',
      width: 120,
      render: (_: unknown, record: Invitation) => (
        <Text type="secondary">
          {new Date(record.expires_at).toLocaleDateString()}
        </Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Invitation) => (
        <Space>
          <Tooltip title="Resend invitation">
            <Button
              type="text"
              icon={<ReloadOutlined />}
              size="small"
              loading={resendInvitationMutation.isPending}
              onClick={() => resendInvitationMutation.mutate(record.id)}
            />
          </Tooltip>
          <Tooltip title="Revoke invitation">
            <Button
              type="text"
              danger
              icon={<CloseOutlined />}
              size="small"
              loading={revokeInvitationMutation.isPending}
              onClick={() => revokeInvitationMutation.mutate(record.id)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const pendingInvitations = invitations.filter(
    (inv: Invitation) => inv.status === 'pending'
  );

  return (
    <div className="space-y-6">
      {/* Members Section */}
      <Card>
        <div className="flex justify-between items-center mb-4">
          <Title level={5} className="!mb-0">
            Team Members ({members.length})
          </Title>
          {canManageMembers && (
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setInviteModalOpen(true)}
            >
              Invite Member
            </Button>
          )}
        </div>

        <Table
          dataSource={members}
          columns={memberColumns}
          rowKey="id"
          loading={membersLoading}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* Pending Invitations Section */}
      {canManageMembers && (
        <Card>
          <Title level={5} className="!mb-4">
            Pending Invitations ({pendingInvitations.length})
          </Title>

          {pendingInvitations.length > 0 ? (
            <Table
              dataSource={pendingInvitations}
              columns={invitationColumns}
              rowKey="id"
              loading={invitationsLoading}
              pagination={false}
              size="middle"
            />
          ) : (
            <Empty
              description="No pending invitations"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </Card>
      )}

      {/* Invite Modal */}
      <InviteMemberModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        workspaceId={workspaceId}
        onSuccess={() => {
          setInviteModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
        }}
      />
    </div>
  );
}
```

---

## Task 4: Invite Member Modal

**File:** `console/src/components/settings/InviteMemberModal.tsx`

```tsx
import { useState } from 'react';
import { Modal, Form, Input, Select, Button, Alert } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onSuccess: () => void;
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
];

export function InviteMemberModal({
  open,
  onClose,
  workspaceId,
  onSuccess,
}: InviteMemberModalProps) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string | null>(null);

  const inviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.invitations.create(workspaceId, email, role),
    onSuccess: () => {
      form.resetFields();
      setError(null);
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      inviteMutation.mutate(values);
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
            prefix={<MailOutlined />}
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
  );
}
```

---

## Task 5: Integration with Settings Page

Update the workspace settings page to include the Team section:

**File:** `console/src/routes/_authenticated/workspaces/$workspaceId/settings.tsx` (modify)

```tsx
// Add import
import { TeamSettings } from '../../../../components/settings/TeamSettings';

// In the settings tabs/sections, add:
{
  key: 'team',
  label: 'Team',
  children: <TeamSettings workspaceId={workspaceId} userRole={userRole} />,
}
```

---

## Deliverables Checklist

- [ ] `console/src/types/member.ts`
- [ ] `console/src/lib/api.ts` (members methods added)
- [ ] `console/src/components/settings/TeamSettings.tsx`
- [ ] `console/src/components/settings/InviteMemberModal.tsx`
- [ ] Settings page updated with Team section
- [ ] Member list displays correctly
- [ ] Role dropdown works for admins
- [ ] Remove member confirmation works
- [ ] Pending invitations displayed
- [ ] Resend/revoke invitation actions work
- [ ] Invite modal validates input
- [ ] Permission-based UI hiding works

---

## Acceptance Criteria

1. Members are listed with name, email, role, and join date
2. Owner role shows crown icon
3. Role dropdown available for appropriate users
4. Role changes persist correctly
5. Member removal requires confirmation
6. Cannot remove owner
7. Cannot remove yourself (use "leave")
8. Pending invitations shown separately
9. Can resend or revoke invitations
10. Invite modal validates email format
11. Role descriptions shown in dropdown
12. Loading states shown during mutations
13. Error messages displayed appropriately
14. Admin/owner-only features hidden from editors/viewers
