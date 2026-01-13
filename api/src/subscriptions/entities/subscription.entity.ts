export type SubscriptionFrequency = 'daily' | 'weekly' | 'monthly';
export type SubscriptionStatus = 'active' | 'paused' | 'disabled';
export type SendStatus = 'pending' | 'success' | 'failed';

export interface Subscription {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  frequency: SubscriptionFrequency;
  day_of_week?: number;
  day_of_month?: number;
  hour: number;
  timezone: string;
  metrics: string[];
  dimensions: string[];
  filters: string; // JSON string
  limit: number;
  status: SubscriptionStatus;
  last_sent_at?: string;
  last_send_status: SendStatus;
  last_error: string;
  next_send_at?: string;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}
