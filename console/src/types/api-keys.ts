export type ApiKeyStatus = 'active' | 'revoked' | 'expired'

export const API_SCOPES = {
  'events.track': 'Send session and event data via SDK',
  'analytics.view': 'Query analytics data',
  'analytics.export': 'Export analytics data',
  'workspace.read': 'Read workspace configuration',
  'filters.manage': 'Create and manage filters',
  'annotations.manage': 'Create and manage annotations',
} as const

export type ApiScope = keyof typeof API_SCOPES

export type ApiKeyRole = 'admin' | 'editor' | 'viewer'

export const API_KEY_ROLES: Record<ApiKeyRole, { label: string; description: string; scopes: ApiScope[] }> = {
  admin: {
    label: 'Admin',
    description: 'Full access to all API features',
    scopes: ['events.track', 'analytics.view', 'analytics.export', 'workspace.read', 'filters.manage', 'annotations.manage'],
  },
  editor: {
    label: 'Editor',
    description: 'Track events and manage analytics',
    scopes: ['events.track', 'analytics.view', 'analytics.export', 'filters.manage', 'annotations.manage'],
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only access to analytics',
    scopes: ['analytics.view', 'workspace.read'],
  },
}

export interface ApiKey {
  id: string
  key_hash: string
  key_prefix: string
  user_id: string
  workspace_id: string | null
  name: string
  description: string
  scopes: ApiScope[]
  status: ApiKeyStatus
  expires_at: string | null
  last_used_at: string | null
  failed_attempts_count: number
  last_failed_attempt_at: string | null
  created_by: string
  revoked_by: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export type PublicApiKey = Omit<ApiKey, 'key_hash'>

export interface CreateApiKeyInput {
  workspace_id: string
  name: string
  description?: string
  scopes: ApiScope[]
  expires_at?: string | null
}

export interface CreateApiKeyResponse {
  key: string
  apiKey: PublicApiKey
}

export interface RevokeApiKeyInput {
  id: string
  revoked_by: string
}

export interface ListApiKeysInput {
  user_id?: string
  workspace_id?: string
  status?: ApiKeyStatus
}
