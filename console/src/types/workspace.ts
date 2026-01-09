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

/**
 * Annotation for marking significant dates on charts.
 */
export interface Annotation {
  id: string
  date: string // ISO date string (YYYY-MM-DD)
  time: string // HH:mm format (e.g., '14:30')
  timezone: string // IANA timezone (e.g., 'America/New_York')
  title: string
  description?: string
  color?: string // Hex color, defaults to '#7763f1'
}

/**
 * Workspace settings stored as JSON.
 */
export interface WorkspaceSettings {
  timescore_reference: number
  bounce_threshold: number
  custom_dimensions?: CustomDimensionLabels | null
  integrations?: WorkspaceIntegration[]
  geo_enabled: boolean
  geo_store_city: boolean
  geo_store_region: boolean
  geo_coordinates_precision: number
  annotations?: Annotation[]
  allowed_domains?: string[]
}

/**
 * Workspace entity with settings nested.
 */
export interface Workspace {
  id: string
  name: string
  website: string
  timezone: string
  currency: string
  logo_url?: string
  created_at: string
  updated_at: string
  status: WorkspaceStatus
  settings: WorkspaceSettings
}

export interface CreateWorkspaceInput {
  id: string
  name: string
  website: string
  timezone: string
  currency: string
  logo_url?: string
  settings?: Partial<WorkspaceSettings>
}

export interface UpdateWorkspaceInput {
  id: string
  name?: string
  website?: string
  timezone?: string
  currency?: string
  logo_url?: string
  status?: WorkspaceStatus
  settings?: Partial<WorkspaceSettings>
}
