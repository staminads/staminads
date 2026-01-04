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
