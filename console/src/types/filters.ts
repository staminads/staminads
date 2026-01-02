export type FilterOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex'
export type FilterAction = 'set_value' | 'unset_value' | 'set_default_value'

export interface FilterCondition {
  field: string
  operator: FilterOperator
  value: string
}

export interface FilterOperation {
  dimension: string
  action: FilterAction
  value?: string // Required for set_value and set_default_value
}

export interface FilterDefinition {
  id: string
  name: string
  priority: number // 0-1000, higher = evaluated first
  order: number // UI display order (drag-drop)
  tags: string[] // e.g., ["channel", "marketing", "paid"]
  conditions: FilterCondition[] // All conditions must match (AND logic)
  operations: FilterOperation[] // Execute when conditions match
  enabled: boolean
  version: string // Hash for staleness detection
  createdAt: string
  updatedAt: string
}

export interface FilterWithStaleness extends FilterDefinition {
  staleSessionCount: number
  totalSessionCount: number
}

// Alias for backward compatibility
export type Filter = FilterDefinition

export interface CreateFilterInput {
  workspace_id: string
  name: string
  priority?: number // Default: 500
  tags?: string[] // Default: []
  conditions: FilterCondition[]
  operations: FilterOperation[]
  enabled?: boolean // Default: true
}

export interface UpdateFilterInput {
  workspace_id: string
  id: string
  name?: string
  priority?: number
  order?: number
  tags?: string[]
  conditions?: FilterCondition[]
  operations?: FilterOperation[]
  enabled?: boolean
}

export interface ReorderFiltersInput {
  workspace_id: string
  filter_ids: string[]
}

// Source fields that can be used in filter conditions
export const SOURCE_FIELDS = [
  // UTM
  { value: 'utm_source', label: 'UTM Source', category: 'UTM' },
  { value: 'utm_medium', label: 'UTM Medium', category: 'UTM' },
  { value: 'utm_campaign', label: 'UTM Campaign', category: 'UTM' },
  { value: 'utm_term', label: 'UTM Term', category: 'UTM' },
  { value: 'utm_content', label: 'UTM Content', category: 'UTM' },
  { value: 'utm_id', label: 'UTM ID', category: 'UTM' },
  { value: 'utm_id_from', label: 'UTM ID From', category: 'UTM' },
  // Traffic
  { value: 'referrer', label: 'Referrer', category: 'Traffic' },
  { value: 'referrer_domain', label: 'Referrer Domain', category: 'Traffic' },
  { value: 'referrer_path', label: 'Referrer Path', category: 'Traffic' },
  { value: 'is_direct', label: 'Is Direct', category: 'Traffic' },
  // Pages
  { value: 'landing_page', label: 'Landing Page', category: 'Pages' },
  { value: 'landing_domain', label: 'Landing Domain', category: 'Pages' },
  { value: 'landing_path', label: 'Landing Path', category: 'Pages' },
  { value: 'path', label: 'Current Path', category: 'Pages' },
  // Device
  { value: 'device', label: 'Device', category: 'Device' },
  { value: 'browser', label: 'Browser', category: 'Device' },
  { value: 'browser_type', label: 'Browser Type', category: 'Device' },
  { value: 'os', label: 'Operating System', category: 'Device' },
  { value: 'user_agent', label: 'User Agent', category: 'Device' },
  { value: 'connection_type', label: 'Connection Type', category: 'Device' },
  // Geo
  { value: 'language', label: 'Language', category: 'Geo' },
  { value: 'timezone', label: 'Timezone', category: 'Geo' },
] as const

// Dimensions that filters can write to
export const WRITABLE_DIMENSIONS = [
  // Channel classification
  { value: 'channel', label: 'Channel', category: 'Channel' },
  { value: 'channel_group', label: 'Channel Group', category: 'Channel' },
  // Custom dimension slots
  { value: 'stm_1', label: 'Custom Dimension 1', category: 'Custom' },
  { value: 'stm_2', label: 'Custom Dimension 2', category: 'Custom' },
  { value: 'stm_3', label: 'Custom Dimension 3', category: 'Custom' },
  { value: 'stm_4', label: 'Custom Dimension 4', category: 'Custom' },
  { value: 'stm_5', label: 'Custom Dimension 5', category: 'Custom' },
  { value: 'stm_6', label: 'Custom Dimension 6', category: 'Custom' },
  { value: 'stm_7', label: 'Custom Dimension 7', category: 'Custom' },
  { value: 'stm_8', label: 'Custom Dimension 8', category: 'Custom' },
  { value: 'stm_9', label: 'Custom Dimension 9', category: 'Custom' },
  { value: 'stm_10', label: 'Custom Dimension 10', category: 'Custom' },
  // UTM fields
  { value: 'utm_source', label: 'UTM Source', category: 'UTM' },
  { value: 'utm_medium', label: 'UTM Medium', category: 'UTM' },
  { value: 'utm_campaign', label: 'UTM Campaign', category: 'UTM' },
  { value: 'utm_term', label: 'UTM Term', category: 'UTM' },
  { value: 'utm_content', label: 'UTM Content', category: 'UTM' },
  // Traffic fields
  { value: 'referrer_domain', label: 'Referrer Domain', category: 'Traffic' },
  { value: 'is_direct', label: 'Is Direct', category: 'Traffic' },
] as const

export const OPERATORS = [
  { value: 'equals' as const, label: 'equals' },
  { value: 'not_equals' as const, label: 'not equals' },
  { value: 'contains' as const, label: 'contains' },
  { value: 'not_contains' as const, label: 'not contains' },
  { value: 'starts_with' as const, label: 'starts with' },
  { value: 'ends_with' as const, label: 'ends with' },
  { value: 'regex' as const, label: 'matches regex' },
] as const

export const FILTER_ACTIONS = [
  { value: 'set_value' as const, label: 'Set value', description: 'Always set to specified value' },
  { value: 'unset_value' as const, label: 'Clear value', description: 'Set to null/empty' },
  { value: 'set_default_value' as const, label: 'Set default', description: 'Set only if currently null' },
] as const

// Common filter tags for UI suggestions
export const SUGGESTED_TAGS = [
  'channel',
  'channel group',
  'marketing',
  'paid',
  'organic',
  'social',
  'direct',
  'referral',
  'email',
  'content',
  'page category',
  'funnel',
] as const

// Backfill types
export type BackfillTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface BackfillTaskProgress {
  id: string
  status: BackfillTaskStatus
  progress_percent: number
  sessions: { processed: number; total: number }
  events: { processed: number; total: number }
  current_chunk: string | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  estimated_remaining_seconds: number | null
  filter_version: string
}

export interface BackfillSummary {
  needsBackfill: boolean
  currentFilterVersion: string
  lastCompletedFilterVersion: string | null
  activeTask: BackfillTaskProgress | null
}

export interface StartBackfillInput {
  workspace_id: string
  lookback_days: number
}
