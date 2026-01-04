export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface WorkspaceMembership {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface MemberWithUser extends WorkspaceMembership {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
}
