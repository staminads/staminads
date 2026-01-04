import { Permission } from '../permissions';

export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

export const API_SCOPES = {
  'events.track': 'Send session and event data via SDK',
  'analytics.view': 'Query analytics data',
  'analytics.export': 'Export analytics data',
  'workspace.read': 'Read workspace configuration',
  'filters.manage': 'Create and manage filters',
  'annotations.manage': 'Create and manage annotations',
} as const;

export type ApiScope = keyof typeof API_SCOPES;

/**
 * Maps API key scope to the user permission required to grant it.
 * null means any user with integrations.manage can grant this scope.
 */
export const SCOPE_TO_PERMISSION: Record<ApiScope, Permission | null> = {
  'events.track': null,
  'analytics.view': 'analytics.view',
  'analytics.export': 'analytics.export',
  'workspace.read': 'analytics.view',
  'filters.manage': 'filters.manage',
  'annotations.manage': 'annotations.manage',
};

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  scopes: ApiScope[];
  status: ApiKeyStatus;
  expires_at: string | null;
  last_used_at: string | null;
  failed_attempts_count: number;
  last_failed_attempt_at: string | null;
  created_by: string;
  revoked_by: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicApiKey = Omit<ApiKey, 'key_hash'>;
