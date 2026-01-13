import type { Filter } from './analytics'

export type SubscriptionFrequency = 'daily' | 'weekly' | 'monthly'
export type SubscriptionStatus = 'active' | 'paused' | 'disabled'
export type SendStatus = 'pending' | 'success' | 'failed'

export interface Subscription {
  id: string
  user_id: string
  workspace_id: string
  name: string
  frequency: SubscriptionFrequency
  day_of_week?: number
  day_of_month?: number
  hour: number
  timezone: string
  metrics: string[]
  dimensions: string[]
  filters: string // JSON string
  limit: number
  status: SubscriptionStatus
  last_sent_at?: string
  last_send_status: SendStatus
  last_error?: string
  next_send_at?: string
  consecutive_failures: number
  created_at: string
  updated_at: string
}

export interface CreateSubscriptionInput {
  workspace_id: string
  name: string
  frequency: SubscriptionFrequency
  day_of_week?: number
  day_of_month?: number
  hour?: number
  timezone?: string
  metrics: string[]
  dimensions?: string[]
  filters?: Filter[]
  limit?: number
}

export interface UpdateSubscriptionInput {
  id: string
  workspace_id: string
  name?: string
  frequency?: SubscriptionFrequency
  day_of_week?: number
  day_of_month?: number
  hour?: number
  timezone?: string
  metrics?: string[]
  dimensions?: string[]
  filters?: Filter[]
  limit?: number
}

export interface PreviewSubscriptionInput {
  workspace_id: string
  name: string
  frequency: SubscriptionFrequency
  day_of_week?: number
  day_of_month?: number
  metrics: string[]
  dimensions?: string[]
  filters?: Filter[]
  limit?: number
}

// Widget categories matching dashboard structure
export const SUBSCRIPTION_WIDGETS = [
  {
    category: 'Top Pages',
    tabs: [
      { key: 'landing_path', label: 'Landing pages' },
      { key: 'exit_path', label: 'Exits' },
    ],
  },
  {
    category: 'Top Sources',
    tabs: [
      { key: 'referrer_domain', label: 'Referrers' },
      { key: 'channel', label: 'Channels' },
      { key: 'channel_group', label: 'Channel groups' },
    ],
  },
  {
    category: 'Top Campaigns',
    tabs: [
      { key: 'utm_campaign', label: 'Campaigns' },
      { key: 'utm_source', label: 'Sources' },
      { key: 'utm_medium', label: 'Mediums' },
      { key: 'utm_content', label: 'Contents' },
      { key: 'utm_term', label: 'Terms' },
    ],
  },
  {
    category: 'Countries',
    tabs: [{ key: 'country', label: 'Countries' }],
  },
  {
    category: 'Devices',
    tabs: [
      { key: 'device', label: 'Devices' },
      { key: 'browser', label: 'Browsers' },
      { key: 'os', label: 'OS' },
    ],
  },
  {
    category: 'Goals',
    tabs: [{ key: 'goal_name', label: 'Goals' }],
  },
] as const

export const AVAILABLE_METRICS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'median_duration', label: 'Median TimeScore' },
  { key: 'bounce_rate', label: 'Bounce Rate' },
  { key: 'median_scroll', label: 'Median Scroll Depth' },
] as const

export const AVAILABLE_LIMITS = [5, 10, 15, 20, 50] as const
