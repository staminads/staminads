export type PasswordResetStatus = 'pending' | 'used' | 'expired';

export interface PasswordResetToken {
  id: string;
  user_id: string;
  token_hash: string;
  status: PasswordResetStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}
