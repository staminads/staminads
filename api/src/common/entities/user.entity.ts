export type UserType = 'user' | 'service_account';
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  type: UserType;
  status: UserStatus;
  is_super_admin: boolean;
  last_login_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicUser = Pick<
  User,
  'id' | 'email' | 'name' | 'status' | 'created_at'
>;
