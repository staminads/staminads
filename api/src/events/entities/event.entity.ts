export type EventName = 'screen_view' | 'scroll' | 'click' | 'ping';

export interface TrackingEvent {
  session_id: string;
  workspace_id: string;
  created_at: string;
  name: EventName | string;
  path: string;
  duration: number;

  // Traffic source
  referrer: string | null;
  referrer_domain: string | null;
  referrer_path: string | null;
  is_direct: boolean;

  // Landing page
  landing_page: string;
  landing_domain: string | null;
  landing_path: string | null;

  // UTM parameters
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  utm_id: string | null;
  utm_id_from: string | null;

  // Channel
  channel: string | null;

  // Screen/Viewport
  screen_width: number | null;
  screen_height: number | null;
  viewport_width: number | null;
  viewport_height: number | null;

  // Device
  device: string | null;
  browser: string | null;
  browser_type: string | null;
  os: string | null;
  user_agent: string | null;
  connection_type: string | null;

  // Browser APIs
  language: string | null;
  timezone: string | null;

  // Engagement
  max_scroll: number | null;

  // SDK
  sdk_version: string | null;

  // Flexible properties
  properties?: Record<string, string>;
}
