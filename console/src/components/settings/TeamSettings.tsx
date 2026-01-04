import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Tag,
  Select,
  Space,
  Popconfirm,
  App,
  Typography,
  Tooltip,
  Avatar,
} from 'antd'
import {
  UserAddOutlined,
  DeleteOutlined,
  CrownOutlined,
  ReloadOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { api } from '../../lib/api'
import { InviteMemberModal } from './InviteMemberModal'
import type { Member, Invitation, Role } from '../../types/member'

const { Title, Text } = Typography

interface TeamSettingsProps {
  workspaceId: string
  userRole: Role
}

const roleColors: Record<Role, string> = {
  owner: 'gold',
  admin: 'purple',
  editor: 'blue',
  viewer: 'default',
}

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

export function TeamSettings({ workspaceId, userRole }: TeamSettingsProps) {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [inviteModalOpen, setInviteModalOpen] = useState(false)

  const canManageMembers = userRole === 'owner' || userRole === 'admin'

  // Fetch current user
  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: api.auth.me,
  })

  // Fetch members
  const {
    data: members = [],
    isLoading: membersLoading,
  } = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api.members.list(workspaceId),
  })

  // Fetch pending invitations
  const {
    data: invitations = [],
    isLoading: invitationsLoading,
  } = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => api.invitations.list(workspaceId),
    enabled: canManageMembers,
  })

  // Fetch SMTP status to check if invitations can be sent
  const { data: smtpInfo } = useQuery({
    queryKey: ['smtp-info', workspaceId],
    queryFn: () => api.smtp.info(workspaceId),
    enabled: canManageMembers,
    staleTime: 30_000,
  })
  const smtpStatus = smtpInfo?.status

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<Role, 'owner'> }) =>
      api.members.updateRole(workspaceId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] })
      message.success('Role updated')
    },
    onError: (error: Error) => {
      message.error(error.message)
    },
  })

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.members.remove(workspaceId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] })
      message.success('Member removed')
    },
    onError: (error: Error) => {
      message.error(error.message)
    },
  })

  // Revoke invitation mutation
  const revokeInvitationMutation = useMutation({
    mutationFn: (id: string) => api.invitations.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] })
      message.success('Invitation revoked')
    },
    onError: (error: Error) => {
      message.error(error.message)
    },
  })

  // Resend invitation mutation
  const resendInvitationMutation = useMutation({
    mutationFn: (id: string) => api.invitations.resend(id),
    onSuccess: () => {
      message.success('Invitation resent')
    },
    onError: (error: Error) => {
      message.error(error.message)
    },
  })

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
        const isCurrentUser = record.user_id === currentUser?.id
        const canChangeRole =
          canManageMembers &&
          record.role !== 'owner' &&
          !isCurrentUser &&
          (userRole === 'owner' || record.role !== 'admin')

        if (record.role === 'owner') {
          return (
            <Tag color={roleColors.owner} icon={<CrownOutlined />}>
              Owner
            </Tag>
          )
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
          )
        }

        return (
          <Tag color={roleColors[record.role]}>
            {record.role.charAt(0).toUpperCase() + record.role.slice(1)}
          </Tag>
        )
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
      align: 'right' as const,
      render: (_: unknown, record: Member) => {
        const isCurrentUser = record.user_id === currentUser?.id
        const canRemove =
          canManageMembers &&
          record.role !== 'owner' &&
          !isCurrentUser &&
          (userRole === 'owner' || record.role !== 'admin')

        if (!canRemove) return null

        return (
          <Popconfirm
            title="Remove member"
            description={`Are you sure you want to remove ${record.user.name}?`}
            onConfirm={() => removeMemberMutation.mutate(record.user_id)}
            okText="Remove"
          >
            <Tooltip title="Remove member">
              <Button
                type="text"
                icon={<DeleteOutlined />}
                size="small"
                loading={removeMemberMutation.isPending}
              />
            </Tooltip>
          </Popconfirm>
        )
      },
    },
  ]

  // Invitation columns
  const invitationColumns = [
    {
      title: 'Email',
      key: 'email',
      render: (_: unknown, record: Invitation) => record.email,
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
      align: 'right' as const,
      render: (_: unknown, record: Invitation) => (
        <Space>
          <Popconfirm
            title="Revoke invitation"
            description={`Are you sure you want to revoke the invitation for ${record.email}?`}
            onConfirm={() => revokeInvitationMutation.mutate(record.id)}
            okText="Revoke"
          >
            <Tooltip title="Revoke invitation">
              <Button
                type="text"
                icon={<CloseOutlined />}
                size="small"
                loading={revokeInvitationMutation.isPending}
              />
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title="Resend invitation"
            description={`Resend invitation email to ${record.email}?`}
            onConfirm={() => resendInvitationMutation.mutate(record.id)}
            okText="Resend"
            disabled={!smtpStatus?.available}
          >
            <Tooltip title={!smtpStatus?.available ? 'SMTP not configured' : 'Resend invitation'}>
              <Button
                type="text"
                icon={<ReloadOutlined />}
                size="small"
                loading={resendInvitationMutation.isPending}
                disabled={!smtpStatus?.available}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const pendingInvitations = invitations.filter(
    (inv: Invitation) => inv.status === 'pending'
  )

  return (
    <div className="space-y-6 max-w-xl">
      {/* Members Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <Title level={5} className="!mb-0">
            Team Members ({members.length})
          </Title>
          {canManageMembers && (
            <Tooltip
              title={!smtpStatus?.available ? 'SMTP not configured. Configure SMTP settings first.' : undefined}
            >
              <Button
                type="primary"
                icon={<UserAddOutlined />}
                onClick={() => setInviteModalOpen(true)}
                disabled={!smtpStatus?.available}
              >
                Invite Member
              </Button>
            </Tooltip>
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
      </div>

      {/* Pending Invitations Section - only show if there are pending invitations */}
      {canManageMembers && pendingInvitations.length > 0 && (
        <div>
          <Title level={5} className="!mt-8 !mb-4">
            Pending Invitations ({pendingInvitations.length})
          </Title>

          <Table
            dataSource={pendingInvitations}
            columns={invitationColumns}
            rowKey="id"
            loading={invitationsLoading}
            pagination={false}
            size="middle"
          />
        </div>
      )}

      {/* Invite Modal */}
      <InviteMemberModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        workspaceId={workspaceId}
        onSuccess={() => {
          setInviteModalOpen(false)
          queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] })
        }}
      />
    </div>
  )
}
