export type FilterOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty' | 'regex';
export type FilterAction = 'set_value' | 'unset_value' | 'set_default_value';

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value?: string; // Optional for valueless operators (is_empty, is_not_empty)
}

export interface FilterOperation {
  dimension: string;
  action: FilterAction;
  value?: string; // Required for set_value and set_default_value
}

export interface FilterDefinition {
  id: string;
  name: string;
  priority: number; // 0-1000, higher = evaluated first
  order: number; // UI display order (drag-drop)
  tags: string[]; // e.g., ["channel", "marketing", "paid"]
  conditions: FilterCondition[]; // All conditions must match (AND logic)
  operations: FilterOperation[]; // Execute when conditions match
  enabled: boolean;
  version: string; // Hash for staleness detection
  createdAt: string;
  updatedAt: string;
}


// Dimensions that filters can write to
export const WRITABLE_DIMENSIONS = [
  // Channel classification
  'channel',
  'channel_group',
  // Custom dimension slots
  'stm_1',
  'stm_2',
  'stm_3',
  'stm_4',
  'stm_5',
  'stm_6',
  'stm_7',
  'stm_8',
  'stm_9',
  'stm_10',
  // UTM fields
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  // Traffic fields
  'referrer_domain',
  'is_direct',
] as const;

export type WritableDimension = (typeof WRITABLE_DIMENSIONS)[number];

// Source fields that can be used in filter conditions
export const SOURCE_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_id_from',
  'referrer',
  'referrer_domain',
  'referrer_path',
  'is_direct',
  'landing_page',
  'landing_domain',
  'landing_path',
  'path',
  'device',
  'browser',
  'browser_type',
  'os',
  'user_agent',
  'connection_type',
  'language',
  'timezone',
] as const;

export type SourceField = (typeof SOURCE_FIELDS)[number];

export const VALID_SOURCE_FIELDS = new Set<string>(SOURCE_FIELDS);
export const VALID_WRITABLE_DIMENSIONS = new Set<string>(WRITABLE_DIMENSIONS);
