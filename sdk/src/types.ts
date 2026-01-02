/**
 * Staminads SDK Types
 */

// Configuration
export interface StaminadsConfig {
  // Required
  workspace_id: string;
  endpoint: string;

  // Optional
  debug?: boolean;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  adClickIds?: string[];

  // Privacy
  anonymizeIP?: boolean;

  // Features
  trackSPA?: boolean;
  trackScroll?: boolean;
  trackClicks?: boolean;
}

export interface InternalConfig extends Required<Omit<StaminadsConfig, 'workspace_id' | 'endpoint'>> {
  workspace_id: string;
  endpoint: string;
}

// Session
export interface Session {
  id: string;
  visitor_id: string;
  workspace_id: string;
  created_at: number;
  updated_at: number;
  last_active_at: number;
  focus_duration_ms: number;
  total_duration_ms: number;
  referrer: string | null;
  landing_page: string;
  utm: UTMParams | null;
  max_scroll_percent: number;
  interaction_count: number;
  sdk_version: string;
  sequence: number;
  dimensions: CustomDimensions;
}

export interface UTMParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  id: string | null;
  id_from: string | null;
}

export interface CustomDimensions {
  [key: number]: string;
}

// Device
export interface DeviceInfo {
  screen_width: number;
  screen_height: number;
  viewport_width: number;
  viewport_height: number;
  device: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  browser_type: string | null;
  os: string;
  user_agent: string;
  connection_type: string;
  timezone: string;
  language: string;
}

// Events
export type EventName = 'screen_view' | 'ping' | 'scroll' | 'conversion';

export interface TrackEventPayload {
  // Required
  workspace_id: string;
  session_id: string;
  name: EventName;
  path: string;
  landing_page: string;

  // Traffic source
  referrer?: string;
  referrer_domain?: string;
  referrer_path?: string;

  // UTM
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
  utm_id_from?: string;

  // Device
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device?: string;
  browser?: string;
  browser_type?: string | null;
  os?: string;
  user_agent?: string;
  connection_type?: string;

  // Locale
  language?: string;
  timezone?: string;

  // Engagement
  duration?: number;
  max_scroll?: number;

  // SDK
  sdk_version?: string;
  tab_id?: string;

  // Custom dimensions
  stm_1?: string;
  stm_2?: string;
  stm_3?: string;
  stm_4?: string;
  stm_5?: string;
  stm_6?: string;
  stm_7?: string;
  stm_8?: string;
  stm_9?: string;
  stm_10?: string;

  // Custom properties
  properties?: Record<string, string>;
}

// Conversion
export interface ConversionData {
  id?: string;
  action: string;
  value?: number;
  currency?: string;
  properties?: Record<string, string>;
}

// Focus states
export type FocusState = 'FOCUSED' | 'BLURRED' | 'HIDDEN';

// Queue
export interface QueuedPayload {
  id: string;
  payload: TrackEventPayload;
  created_at: number;
  attempts: number;
  last_attempt: number | null;
}

// Public API
export interface StaminadsAPI {
  init(config: StaminadsConfig): void;
  getSessionId(): string;
  getVisitorId(): string;
  getFocusDuration(): number;
  getTotalDuration(): number;
  trackPageView(url?: string): void;
  trackEvent(name: string, properties?: Record<string, string>): void;
  trackConversion(data: ConversionData): void;
  setDimension(index: number, value: string): void;
  setDimensions(dimensions: Record<number, string>): void;
  getDimension(index: number): string | null;
  clearDimensions(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  debug(): SessionDebugInfo;
}

export interface SessionDebugInfo {
  session: Session | null;
  config: InternalConfig | null;
  focusState: FocusState;
  isTracking: boolean;
  queueLength: number;
}
