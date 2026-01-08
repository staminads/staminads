export type EventName = 'screen_view' | 'scroll' | 'click' | 'ping' | 'goal';

export interface TrackingEvent {
  session_id: string;
  workspace_id: string;
  received_at: string; // Server timestamp
  created_at: string; // SDK session start
  updated_at: string; // SDK last interaction
  name: string;
  path: string;
  duration: number;
  page_duration: number;
  previous_path: string;

  // Traffic source
  referrer: string;
  referrer_domain: string;
  referrer_path: string;
  is_direct: boolean;

  // Landing page
  landing_page: string;
  landing_domain: string;
  landing_path: string;

  // UTM parameters
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  utm_id: string;
  utm_id_from: string;

  // Channel classification
  channel: string;
  channel_group: string;

  // Custom dimensions (stm_1 through stm_10)
  stm_1: string;
  stm_2: string;
  stm_3: string;
  stm_4: string;
  stm_5: string;
  stm_6: string;
  stm_7: string;
  stm_8: string;
  stm_9: string;
  stm_10: string;

  // Screen/Viewport
  screen_width: number;
  screen_height: number;
  viewport_width: number;
  viewport_height: number;

  // Device
  device: string;
  browser: string;
  browser_type: string;
  os: string;
  user_agent: string;
  connection_type: string;

  // Browser APIs
  language: string;
  timezone: string;

  // Geo location (derived from IP, IP never stored)
  country: string;
  region: string;
  city: string;
  latitude: number | null;
  longitude: number | null;

  // Engagement
  max_scroll: number;

  // SDK
  sdk_version: string;

  // Flexible properties
  properties?: Record<string, string>;

  // V3 Session Payload fields
  dedup_token?: string; // Deterministic token for deduplication
  page_number?: number; // Page sequence within session
  _version?: number; // Server timestamp for conflict resolution
  goal_name?: string; // Goal identifier
  goal_value?: number; // Goal value (e.g., purchase amount)
}
