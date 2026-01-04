export interface InvitationDetails {
  id: string
  workspace: {
    id: string
    name: string
    website: string
    logo_url?: string
  }
  email: string
  role: 'admin' | 'editor' | 'viewer'
  inviter: {
    name: string
  }
  existingUser: boolean
  expiresAt: string
}

export interface AcceptInvitationRequest {
  token: string
  name?: string
  password?: string
}

export interface AcceptInvitationResponse {
  userId: string
  workspaceId: string
}
