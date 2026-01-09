export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

/**
 * API key roles - same as user roles but without 'owner' for security.
 * API keys should not have owner-level access.
 */
export type ApiKeyRole = 'admin' | 'editor' | 'viewer';

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  role: ApiKeyRole;
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
