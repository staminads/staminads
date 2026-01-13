export const AUDIT_ACTIONS = {
  // Invitations
  'invitation.sent': 'Invitation created and email sent',
  'invitation.accepted': 'User accepted invitation',
  'invitation.revoked': 'Invitation revoked by admin',
  'invitation.expired': 'Invitation expired',

  // Members
  'member.added': 'Member added to workspace',
  'member.role_changed': 'Member role updated',
  'member.role_updated': 'Member role updated',
  'member.removed': 'Member removed from workspace',
  'member.left': 'Member left workspace voluntarily',

  // Ownership
  'ownership.transferred': 'Workspace ownership transferred',

  // Password
  'password.reset_requested': 'Password reset email sent',
  'password.changed': 'Password changed',

  // API Keys
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',

  // Subscriptions
  'subscription.created': 'Report subscription created',
  'subscription.updated': 'Report subscription updated',
  'subscription.deleted': 'Report subscription deleted',
  'subscription.paused': 'Report subscription paused',
  'subscription.resumed': 'Report subscription resumed',
  'subscription.report_sent': 'Report email sent',
  'subscription.report_failed': 'Report email failed to send',
  'subscription.unsubscribed': 'User unsubscribed via email link',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export type AuditTargetType =
  | 'user'
  | 'invitation'
  | 'membership'
  | 'api_key'
  | 'workspace'
  | 'subscription';

export interface AuditLog {
  id: string;
  user_id: string;
  workspace_id: string | null;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
