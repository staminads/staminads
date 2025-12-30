export type CustomDimensionOperator = 'equals' | 'regex' | 'contains'

export interface CustomDimensionCondition {
  field: string
  operator: CustomDimensionOperator
  value: string
}

export interface CustomDimensionRule {
  conditions: CustomDimensionCondition[]
  outputValue: string
}

export interface CustomDimensionDefinition {
  id: string
  slot: number // 1-10 (maps to cd_1...cd_10)
  name: string
  category: string
  order?: number // Display order within category
  rules: CustomDimensionRule[]
  defaultValue?: string
  version: string
  createdAt: string
  updatedAt: string
}

export interface CustomDimensionWithStaleness extends CustomDimensionDefinition {
  staleSessionCount: number
  totalSessionCount: number
}

export interface CreateCustomDimensionInput {
  workspace_id: string
  name: string
  slot?: number
  category?: string
  rules: CustomDimensionRule[]
  defaultValue?: string
}

export interface UpdateCustomDimensionInput {
  workspace_id: string
  id: string
  name?: string
  category?: string
  rules?: CustomDimensionRule[]
  defaultValue?: string
}

export interface ReorderCustomDimensionsInput {
  workspace_id: string
  dimension_ids: string[]
}

export interface TestCustomDimensionInput {
  workspace_id: string
  dimension_id?: string
  rules?: CustomDimensionRule[]
  defaultValue?: string
  testValues: Record<string, string | null>
}

export interface TestResult {
  inputValues: Record<string, string | null>
  matchedRuleIndex: number | null
  outputValue: string | null
}

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

export const OPERATORS = [
  { value: 'equals' as const, label: 'equals' },
  { value: 'contains' as const, label: 'contains' },
  { value: 'regex' as const, label: 'matches regex' },
] as const
