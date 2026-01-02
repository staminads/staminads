/**
 * Session management
 * Handles session creation, persistence, and expiry
 */

import type { Session, UTMParams, CustomDimensions, InternalConfig } from '../types';
import { Storage, TabStorage, STORAGE_KEYS } from '../storage/storage';
import { generateUUIDv4, generateUUIDv7 } from '../utils/uuid';
import { parseUTMParams } from '../utils/utm';

const SDK_VERSION = '5.0.0';

export class SessionManager {
  private storage: Storage;
  private tabStorage: TabStorage;
  private config: InternalConfig;
  private session: Session | null = null;
  private tabId: string;
  private debug: boolean;

  constructor(storage: Storage, tabStorage: TabStorage, config: InternalConfig) {
    this.storage = storage;
    this.tabStorage = tabStorage;
    this.config = config;
    this.debug = config.debug;
    this.tabId = this.getOrCreateTabId();
  }

  /**
   * Get or create session
   * A new session is ONLY created when:
   * 1. No existing session exists
   * 2. Previous session has expired
   */
  getOrCreateSession(): Session {
    const stored = this.storage.get<Session>(STORAGE_KEYS.SESSION);

    // Resume existing session if valid
    if (stored && !this.isSessionExpired(stored)) {
      stored.last_active_at = Date.now();
      stored.updated_at = Date.now();
      stored.sequence++;
      this.session = stored;
      this.saveSession();

      // Ensure visitor_id is stored separately (for persistence across sessions)
      if (!this.storage.get<string>(STORAGE_KEYS.VISITOR_ID)) {
        this.storage.set(STORAGE_KEYS.VISITOR_ID, stored.visitor_id);
      }

      if (this.debug) {
        console.log('[Staminads] Resumed session:', stored.id);
      }

      return stored;
    }

    // Create new session
    return this.createSession();
  }

  /**
   * Create a new session
   */
  private createSession(): Session {
    const now = Date.now();
    const utm = parseUTMParams(window.location.href, this.config.adClickIds);

    // Get or create visitor ID
    let visitorId = this.storage.get<string>(STORAGE_KEYS.VISITOR_ID);
    if (!visitorId) {
      visitorId = generateUUIDv4();
      this.storage.set(STORAGE_KEYS.VISITOR_ID, visitorId);
    }

    const session: Session = {
      id: generateUUIDv7(),
      visitor_id: visitorId,
      workspace_id: this.config.workspace_id,
      created_at: now,
      updated_at: now,
      last_active_at: now,
      focus_duration_ms: 0,
      total_duration_ms: 0,
      referrer: document.referrer || null,
      landing_page: window.location.href,
      utm: this.hasUTMValues(utm) ? utm : null,
      max_scroll_percent: 0,
      interaction_count: 0,
      sdk_version: SDK_VERSION,
      sequence: 0,
      dimensions: this.loadDimensions(),
    };

    this.session = session;
    this.saveSession();

    if (this.debug) {
      console.log('[Staminads] Created session:', session.id);
    }

    return session;
  }

  /**
   * Check if session has expired
   */
  private isSessionExpired(session: Session): boolean {
    return Date.now() - session.last_active_at > this.config.sessionTimeout;
  }

  /**
   * Check if UTM has any values
   */
  private hasUTMValues(utm: UTMParams): boolean {
    return Boolean(
      utm.source || utm.medium || utm.campaign || utm.term || utm.content || utm.id
    );
  }

  /**
   * Get current session
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Update session
   */
  updateSession(updates: Partial<Session>): void {
    if (!this.session) return;

    Object.assign(this.session, updates, {
      updated_at: Date.now(),
      last_active_at: Date.now(),
    });

    this.saveSession();
  }

  /**
   * Save session to storage
   */
  private saveSession(): void {
    if (!this.session) return;
    this.storage.set(STORAGE_KEYS.SESSION, this.session);
  }

  /**
   * Get tab ID (unique per browser tab)
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Get or create tab ID
   */
  private getOrCreateTabId(): string {
    let tabId = this.tabStorage.get<string>(STORAGE_KEYS.TAB_ID);
    if (!tabId) {
      tabId = generateUUIDv4();
      this.tabStorage.set(STORAGE_KEYS.TAB_ID, tabId);
    }
    return tabId;
  }

  /**
   * Get visitor ID
   */
  getVisitorId(): string {
    return this.session?.visitor_id || '';
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.session?.id || '';
  }

  // Custom Dimensions

  /**
   * Set a custom dimension (1-10)
   */
  setDimension(index: number, value: string): void {
    if (index < 1 || index > 10) {
      throw new Error('Dimension index must be between 1 and 10');
    }

    if (typeof value !== 'string') {
      throw new Error('Dimension value must be a string');
    }

    if (value.length > 256) {
      throw new Error('Dimension value must be 256 characters or less');
    }

    if (!this.session) return;

    this.session.dimensions[index] = value;
    this.saveDimensions();
    this.saveSession();

    if (this.debug) {
      console.log(`[Staminads] Set dimension stm_${index}:`, value);
    }
  }

  /**
   * Set multiple dimensions
   */
  setDimensions(dimensions: Record<number, string>): void {
    for (const [index, value] of Object.entries(dimensions)) {
      this.setDimension(Number(index), value);
    }
  }

  /**
   * Get a dimension value
   */
  getDimension(index: number): string | null {
    if (!this.session) return null;
    return this.session.dimensions[index] || null;
  }

  /**
   * Clear all dimensions
   */
  clearDimensions(): void {
    if (!this.session) return;
    this.session.dimensions = {};
    this.saveDimensions();
    this.saveSession();
  }

  /**
   * Get all dimensions as payload fields
   */
  getDimensionsPayload(): Record<string, string> {
    if (!this.session) return {};

    const payload: Record<string, string> = {};
    for (const [index, value] of Object.entries(this.session.dimensions)) {
      payload[`stm_${index}`] = value;
    }
    return payload;
  }

  /**
   * Load dimensions from storage
   */
  private loadDimensions(): CustomDimensions {
    return this.storage.get<CustomDimensions>(STORAGE_KEYS.DIMENSIONS) || {};
  }

  /**
   * Save dimensions to storage
   */
  private saveDimensions(): void {
    if (!this.session) return;
    this.storage.set(STORAGE_KEYS.DIMENSIONS, this.session.dimensions);
  }

  /**
   * Reset session (clear and create new)
   */
  reset(): Session {
    this.storage.remove(STORAGE_KEYS.SESSION);
    this.storage.remove(STORAGE_KEYS.DIMENSIONS);
    this.session = null;
    return this.createSession();
  }
}
