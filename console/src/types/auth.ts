export interface User {
  id: string
  email: string
  name: string
}

export interface LoginResponse {
  access_token: string
  user: User
}

export interface RegisterRequest {
  email: string
  name: string
  password: string
  invitationToken?: string
}

export interface ForgotPasswordRequest {
  email: string
}

export interface ResetPasswordRequest {
  token: string
  newPassword: string
}

export interface Session {
  id: string
  ip_address: string | null
  user_agent: string | null
  expires_at: string
  created_at: string
}
