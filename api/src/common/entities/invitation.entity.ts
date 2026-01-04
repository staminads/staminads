import { Role } from './membership.entity';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
  id: string;
  workspace_id: string;
  email: string;
  role: Exclude<Role, 'owner'>; // Can't invite as owner
  token_hash: string;
  invited_by: string;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvitationWithInviter extends Invitation {
  inviter: {
    id: string;
    name: string;
    email: string;
  };
}
