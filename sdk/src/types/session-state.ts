/**
 * V3 Session Payload Types
 *
 * These types define the session payload format for the V3 SDK.
 * The SDK builds a cumulative actions[] array that gets sent to track.session.
 */

export type ActionType = 'pageview' | 'goal';

/**
 * Completed pageview action (user has left the page)
 */
export interface PageviewAction {
  type: 'pageview';
  path: string;
  page_number: number;
  duration: number; // milliseconds
  scroll: number; // max scroll percentage (0-100)
  entered_at: number; // epoch ms
  exited_at: number; // epoch ms
}

/**
 * Goal action (conversion event)
 */
export interface GoalAction {
  type: 'goal';
  name: string;
  path: string;
  page_number: number;
  timestamp: number; // epoch ms
  value?: number;
  properties?: Record<string, string>;
}

export type Action = PageviewAction | GoalAction;

/**
 * Page currently being viewed (not yet finalized)
 */
export interface CurrentPage {
  path: string;
  page_number: number;
  entered_at: number; // epoch ms
  scroll: number; // current max scroll
}

/**
 * Session attributes (traffic source, device info, etc.)
 * Sent only on first payload of session.
 */
export interface SessionAttributes {
  referrer?: string;
  landing_page: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
  utm_id_from?: string;
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device?: string;
  browser?: string;
  browser_type?: string;
  os?: string;
  user_agent?: string;
  connection_type?: string;
  language?: string;
  timezone?: string;
}

/**
 * Full session payload sent to /api/track.session
 */
export interface SessionPayload {
  workspace_id: string;
  session_id: string;
  actions: Action[];
  current_page?: CurrentPage;
  checkpoint?: number;
  attributes?: SessionAttributes;
  created_at: number;
  updated_at: number;
  sdk_version: string;
}

/**
 * Snapshot of SessionState for persistence
 */
export interface SessionStateSnapshot {
  actions: Action[];
  currentPage: CurrentPage | null;
  checkpoint: number;
  attributesSent: boolean;
}

/**
 * Result from sending a session payload
 */
export interface SendResult {
  success: boolean;
  checkpoint?: number; // Server's acknowledged checkpoint
  error?: string;
}
