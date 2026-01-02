export type WorkspaceStatus = 'initializing' | 'active' | 'inactive' | 'error'

/**
 * Custom dimension labels map.
 * Maps slot number (as string) to label.
 * Example: { "1": "Channel Group", "2": "Channel" }
 */
export type CustomDimensionLabels = Record<string, string>

export interface WorkspaceIntegrationSettings {
  api_key_encrypted: string
  model: string
  max_tokens?: number
  temperature?: number
}

export interface WorkspaceIntegrationLimits {
  max_requests_per_hour?: number
  max_tokens_per_day?: number
}

export interface WorkspaceIntegration {
  id: string
  type: 'anthropic'
  enabled: boolean
  created_at: string
  updated_at: string
  settings: WorkspaceIntegrationSettings
  limits?: WorkspaceIntegrationLimits
}

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
  bounce_threshold: number
  status: WorkspaceStatus
  custom_dimensions?: CustomDimensionLabels | null
  integrations?: WorkspaceIntegration[]
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
  custom_dimensions?: CustomDimensionLabels
  timescore_reference?: number
  bounce_threshold?: number
  integrations?: WorkspaceIntegration[]
}
