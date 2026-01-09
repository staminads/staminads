export type ApiKeyStatus = 'active' | 'revoked' | 'expired'

export type ApiKeyRole = 'admin' | 'editor' | 'viewer'

export const API_KEY_ROLE_INFO: Record<ApiKeyRole, { label: string; description: string }> = {
  admin: {
    label: 'Admin',
    description: 'Full access to all API features',
  },
  editor: {
    label: 'Editor',
    description: 'Analytics, filters, and annotations',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only access to analytics',
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
  role: ApiKeyRole
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
  role: ApiKeyRole
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
