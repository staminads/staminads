export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicSession = Omit<Session, 'token_hash'>;
