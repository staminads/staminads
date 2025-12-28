export type WorkspaceStatus = 'initializing' | 'active' | 'inactive' | 'error'

export interface Workspace {
  id: string
  name: string
  website: string
  timezone: string
  currency: string
  logo_url?: string
  created_at: string
  updated_at: string
  timescore_reference: number
  status: WorkspaceStatus
}

export interface CreateWorkspaceInput {
  id: string
  name: string
  website: string
  timezone: string
  currency: string
  logo_url?: string
}

export interface UpdateWorkspaceInput {
  id: string
  name?: string
  website?: string
  timezone?: string
  currency?: string
  logo_url?: string
}
