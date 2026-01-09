/**
 * Staminads SDK v6.0
 * Ultra-reliable web analytics for tracking TimeScore metrics
 * V3 Session Payload Architecture
 */

import type {
  StaminadsConfig,
  InternalConfig,
  GoalData,
  SessionDebugInfo,
  DeviceInfo,
  HeartbeatTier,
  HeartbeatState,
} from './types';
import type { SessionAttributes } from './types/session-state';
import { Storage, TabStorage } from './storage/storage';
import { SessionManager } from './core/session';
import { SessionState, SessionStateConfig } from './core/session-state';
import { Sender } from './transport/sender';
import { DeviceDetector } from './detection/device';
import { ScrollTracker } from './events/scroll';
import { NavigationTracker } from './events/navigation';
import { isBot } from './detection/bot';
import { DEFAULT_AD_CLICK_IDS } from './utils/utm';
import { CrossDomainLinker } from './core/cross-domain';

// Heartbeat constants
const MIN_HEARTBEAT_INTERVAL = 5000; // 5 seconds minimum
const MIN_HEARTBEAT_MAX_DURATION = 60 * 1000; // 1 minute minimum
const SEND_DEBOUNCE_MS = 100;

// Default heartbeat tiers
const DEFAULT_HEARTBEAT_TIERS: HeartbeatTier[] = [
  // 0-3 min: High frequency (initial engagement is critical)
  { after: 0, desktopInterval: 10000, mobileInterval: 7000 },
  // 3-5 min: Medium frequency (user is engaged, reduce load)
  { after: 3 * 60 * 1000, desktopInterval: 20000, mobileInterval: 14000 },
  // 5-10 min: Low frequency (long-form content, minimal pings)
  { after: 5 * 60 * 1000, desktopInterval: 30000, mobileInterval: 21000 },
];

// Default configuration
const DEFAULT_CONFIG: Omit<InternalConfig, 'workspace_id' | 'endpoint'> = {
  debug: false,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  heartbeatInterval: 10000, // 10 seconds (legacy, used as fallback)
  adClickIds: DEFAULT_AD_CLICK_IDS,
  trackSPA: true,
  trackScroll: true,
  trackClicks: false,
  heartbeatTiers: DEFAULT_HEARTBEAT_TIERS,
  heartbeatMaxDuration: 10 * 60 * 1000, // 10 minutes
  resetHeartbeatOnNavigation: false,
  // Cross-domain tracking
  crossDomains: [],
  crossDomainExpiry: 120, // 2 minutes
  crossDomainStripParams: true,
};

export class StaminadsSDK {
  private config: InternalConfig | null = null;
  private storage: Storage | null = null;
  private tabStorage: TabStorage | null = null;
  private sessionManager: SessionManager | null = null;
  private sessionState: SessionState | null = null;
  private sender: Sender | null = null;
  private deviceDetector: DeviceDetector | null = null;
  private scrollTracker: ScrollTracker | null = null;
  private navigationTracker: NavigationTracker | null = null;
  private crossDomainLinker: CrossDomainLinker | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private sendDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatState: HeartbeatState = {
    activeStartTime: 0,
    accumulatedActiveMs: 0,
    isActive: false,
    maxDurationReached: false,
    lastPingTime: 0,
    currentTierIndex: 0,
    pageActiveMs: 0,
    pageStartTime: 0,
  };
  private isMobileDevice = false;
  private isTracking = false;
  private isPaused = false;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private flushed = false;

  /**
   * Initialize the SDK (called by index.ts from global config or manual init)
   * Returns the init promise so callers can await if needed
   */
  init(userConfig: StaminadsConfig): Promise<void> {
    // If already initialized or initializing, return existing promise
    if (this.isInitialized) {
      return Promise.resolve();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    // Store the promise for ensureInitialized to await
    this.initPromise = this.initializeAsync(userConfig);
    return this.initPromise;
  }

  /**
   * Async initialization logic
   */
  private async initializeAsync(userConfig: StaminadsConfig): Promise<void> {
    // Validate required fields
    if (!userConfig.workspace_id) {
      throw new Error('workspace_id is required');
    }
    if (!userConfig.endpoint) {
      throw new Error('endpoint is required');
    }

    // Check for bots
    if (isBot()) {
      console.log('[Staminads] Bot detected, tracking disabled');
      return;
    }

    // Merge config
    this.config = {
      ...DEFAULT_CONFIG,
      ...userConfig,
    } as InternalConfig;

    // Validate and normalize heartbeat tiers
    this.config.heartbeatTiers = this.validateTiers(this.config.heartbeatTiers);

    // Validate heartbeat max duration
    if (this.config.heartbeatMaxDuration !== 0 &&
        this.config.heartbeatMaxDuration < MIN_HEARTBEAT_MAX_DURATION) {
      this.config.heartbeatMaxDuration = MIN_HEARTBEAT_MAX_DURATION;
    }

    // Initialize storage
    this.storage = new Storage();
    this.tabStorage = new TabStorage();

    // Initialize device detector
    this.deviceDetector = new DeviceDetector();
    this.deviceInfo = await this.deviceDetector.detectWithClientHints();

    // Set mobile device flag for heartbeat intervals
    this.isMobileDevice = this.deviceInfo?.device !== 'desktop';

    // Read cross-domain param BEFORE session creation
    const crossDomainPayload = CrossDomainLinker.readParam(this.config.crossDomainExpiry);

    // Initialize session manager
    this.sessionManager = new SessionManager(
      this.storage,
      this.tabStorage,
      this.config
    );

    // Inject cross-domain payload if present
    if (crossDomainPayload) {
      this.sessionManager.setCrossDomainInput({
        visitorId: crossDomainPayload.v,
        sessionId: crossDomainPayload.s,
        timestamp: crossDomainPayload.t,
        expiry: this.config.crossDomainExpiry,
      });
    }

    // Get or create session (uses cross-domain payload if valid)
    const session = this.sessionManager.getOrCreateSession();

    // Strip _stm param from URL after processing
    if (crossDomainPayload && this.config.crossDomainStripParams) {
      CrossDomainLinker.stripParam();
    }

    // Initialize sender
    this.sender = new Sender(this.config.endpoint, this.storage, this.config.debug);

    // Initialize scroll tracker
    if (this.config.trackScroll) {
      this.scrollTracker = new ScrollTracker();
      // No milestone callback needed - we just track max scroll
      this.scrollTracker.start();
    }

    // Initialize navigation tracker
    if (this.config.trackSPA) {
      this.navigationTracker = new NavigationTracker();
      this.navigationTracker.setNavigationCallback((url) => this.onNavigation(url));
      this.navigationTracker.start();
    }

    // Initialize cross-domain linker if configured
    if (this.config.crossDomains.length > 0) {
      this.crossDomainLinker = new CrossDomainLinker({
        domains: this.config.crossDomains,
        expiry: this.config.crossDomainExpiry,
        debug: this.config.debug,
      });
      this.crossDomainLinker.setIdGetters(
        () => this.sessionManager?.getVisitorId() || '',
        () => this.sessionManager?.getSessionId() || ''
      );
      this.crossDomainLinker.start();
    }

    // Initialize SessionState (V3)
    const sessionStateConfig: SessionStateConfig = {
      workspace_id: this.config.workspace_id,
      session_id: session.id,
      created_at: session.created_at,
    };
    this.sessionState = new SessionState(sessionStateConfig);
    this.sessionState.restore(); // Restore from sessionStorage if available

    // Add initial pageview
    this.sessionState.addPageview(window.location.pathname);

    // Bind events
    this.bindEvents();

    // Start tracking
    this.isTracking = true;
    this.isInitialized = true;

    // Initialize heartbeat state
    const now = Date.now();
    this.heartbeatState.pageStartTime = now;
    this.heartbeatState.activeStartTime = now;

    // Start heartbeat
    this.startHeartbeat();

    // Send initial payload (immediate, with attributes)
    await this.sendPayload();

    if (this.config.debug) {
      console.log('[Staminads] Initialized', {
        session_id: session.id,
        visitor_id: this.sessionManager.getVisitorId(),
        device: this.deviceInfo,
      });
    }
  }

  /**
   * Bind browser events
   */
  private bindEvents(): void {
    // Visibility change (tab switch, minimize)
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Window focus/blur (alt-tab, window switch)
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('blur', this.onBlur);

    // Page lifecycle (mobile freeze/resume)
    document.addEventListener('freeze', this.onFreeze);
    document.addEventListener('resume', this.onResume);

    // Page unload
    window.addEventListener('pagehide', this.onUnload);
    window.addEventListener('beforeunload', this.onUnload);

    // Back-forward cache
    window.addEventListener('pageshow', this.onPageShow);
  }

  /**
   * Visibility change handler
   */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.stopHeartbeat(true); // Accumulate active time
      this.flushOnce();
    } else if (document.visibilityState === 'visible') {
      this.flushed = false;
      if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
        // Resume heartbeat with fresh timing
        this.resumeHeartbeat();
      }
    }
  };

  /**
   * Window focus handler
   */
  private onFocus = (): void => {
    this.flushed = false;
    if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
      this.resumeHeartbeat();
    }
  };

  /**
   * Window blur handler
   */
  private onBlur = (): void => {
    this.stopHeartbeat(true); // Accumulate active time
    this.flushOnce();
  };

  /**
   * Page freeze handler (mobile)
   */
  private onFreeze = (): void => {
    this.stopHeartbeat(true); // Accumulate active time
    this.flushOnce();
  };

  /**
   * Page resume handler (mobile)
   */
  private onResume = (): void => {
    this.flushed = false;
    if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
      this.resumeHeartbeat();
    }
  };

  /**
   * Page unload handler
   */
  private onUnload = (): void => {
    this.flushOnce();
  };

  /**
   * Page show handler (bfcache)
   */
  private onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      // Page was restored from bfcache
      this.flushed = false;
      if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
        this.resumeHeartbeat();
      }
      // Restore SessionState if needed
      this.sessionState?.restore();
      if (this.config?.debug) {
        console.log('[Staminads] Restored from bfcache');
      }
    }
  };

  /**
   * Flush once (deduplicate unload events)
   */
  private flushOnce(): void {
    if (this.flushed) return;
    this.flushed = true;

    if (!this.sessionState || !this.sender) return;

    // Update scroll before finalizing
    if (this.scrollTracker) {
      this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
    }

    // Finalize current page
    this.sessionState.finalizeForUnload();

    // Build and send via beacon
    const attributes = this.buildAttributes();
    const payload = this.sessionState.buildPayload(attributes);
    this.sender.sendSessionBeacon(payload);

    // Persist final state
    this.sessionState.persist();
  }

  /**
   * Navigation callback
   */
  private onNavigation(url: string): void {
    if (!this.sessionState) return;

    if (this.config?.debug) {
      console.log('[Staminads] Navigation:', url);
    }

    // Update scroll before finalizing page
    if (this.scrollTracker) {
      this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
    }

    // Add new pageview (this finalizes the previous page)
    this.sessionState.addPageview(window.location.pathname);

    // Reset scroll tracking for new page
    this.scrollTracker?.reset();

    // Reset page timer
    this.resetPageActiveTime();

    // Optionally reset session heartbeat timer
    if (this.config?.resetHeartbeatOnNavigation) {
      this.resetHeartbeatState();
      this.startHeartbeat();
    }

    // Debounced send (navigation can be rapid in SPAs)
    this.scheduleDebouncedSend();

    // Persist state
    this.sessionState.persist();
  }

  /**
   * Start heartbeat with tiered intervals
   */
  private startHeartbeat(): void {
    if (!this.config) return;

    // Don't restart if max duration reached
    if (this.heartbeatState.maxDurationReached) {
      if (this.config.debug) {
        console.log('[Staminads] Heartbeat not started: max duration reached');
      }
      return;
    }

    // Clear existing heartbeat
    this.stopHeartbeat(false); // Don't accumulate time (we're starting fresh)

    // Record when we became active
    const now = Date.now();
    this.heartbeatState.activeStartTime = now;
    this.heartbeatState.isActive = true;
    this.heartbeatState.lastPingTime = now;

    // Start the heartbeat loop
    this.scheduleNextHeartbeat();
  }

  /**
   * Resume heartbeat after visibility/focus change
   */
  private resumeHeartbeat(): void {
    if (!this.config) return;

    // Don't restart if max duration reached
    if (this.heartbeatState.maxDurationReached) {
      return;
    }

    // Resume with fresh timing
    const now = Date.now();
    this.heartbeatState.activeStartTime = now;
    this.heartbeatState.pageStartTime = now;
    this.heartbeatState.isActive = true;
    this.heartbeatState.lastPingTime = now;
    this.scheduleNextHeartbeat();
  }

  /**
   * Schedule next heartbeat based on current tier
   */
  private scheduleNextHeartbeat(): void {
    if (!this.config || !this.heartbeatState.isActive) return;

    // Check max duration BEFORE scheduling
    if (this.checkAndUpdateMaxDuration()) {
      this.stopHeartbeat(true);
      return;
    }

    // Get current interval based on active time
    const interval = this.getCurrentInterval();

    // Null interval means stop (tier config says to stop)
    if (interval === null) {
      this.heartbeatState.maxDurationReached = true;
      this.stopHeartbeat(true);
      if (this.config.debug) {
        console.log('[Staminads] Heartbeat stopped by tier configuration');
      }
      return;
    }

    // Calculate target time with drift compensation
    const targetTime = this.heartbeatState.lastPingTime + interval;
    const now = Date.now();
    const delay = Math.max(0, targetTime - now);

    // Schedule next ping
    this.heartbeatTimeout = setTimeout(() => {
      // CRITICAL: Check visibility and state before sending
      if (this.shouldSendPing()) {
        const actualTime = Date.now();
        const drift = actualTime - targetTime;

        // Log excessive drift in debug mode
        if (drift > 1000 && this.config?.debug) {
          console.warn(`[Staminads] Heartbeat drift: ${drift}ms`);
        }

        // Update tier index for metadata
        const tierResult = this.getCurrentTier();
        if (tierResult) {
          this.heartbeatState.currentTierIndex = tierResult.index;
        }

        // Send ping with SessionState payload
        this.sendPingEvent();

        // Update last ping time for next calculation
        this.heartbeatState.lastPingTime = actualTime;

        // Schedule next ping
        this.scheduleNextHeartbeat();
      }
    }, delay);
  }

  /**
   * Check if we should send a ping right now.
   * Guards against race conditions with visibility changes.
   */
  private shouldSendPing(): boolean {
    return (
      !this.isPaused &&
      this.isTracking &&
      this.heartbeatState.isActive &&
      !document.hidden &&
      document.visibilityState === 'visible'
    );
  }

  /**
   * Send ping event with SessionState payload
   */
  private sendPingEvent(): void {
    if (!this.sessionState) return;

    // Update scroll from ScrollTracker
    if (this.scrollTracker) {
      this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
    }

    // Send periodic payload (non-blocking)
    this.sendPayload().catch(() => {});
  }

  /**
   * Stop heartbeat with optional time accumulation
   */
  private stopHeartbeat(accumulateTime: boolean = true): void {
    // Accumulate active time before stopping
    if (accumulateTime && this.heartbeatState.isActive) {
      const now = Date.now();
      const activeTime = now - this.heartbeatState.activeStartTime;
      this.heartbeatState.accumulatedActiveMs += activeTime;

      // Also accumulate page active time
      const pageTime = now - this.heartbeatState.pageStartTime;
      this.heartbeatState.pageActiveMs += pageTime;
    }

    this.heartbeatState.isActive = false;

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Get total active time in milliseconds
   */
  private getTotalActiveMs(): number {
    let total = this.heartbeatState.accumulatedActiveMs;
    if (this.heartbeatState.isActive) {
      total += Date.now() - this.heartbeatState.activeStartTime;
    }
    return total;
  }

  /**
   * Check and update max duration flag
   */
  private checkAndUpdateMaxDuration(): boolean {
    if (!this.config || this.config.heartbeatMaxDuration === 0) {
      return false; // Unlimited
    }

    const totalActiveMs = this.getTotalActiveMs();

    if (totalActiveMs >= this.config.heartbeatMaxDuration) {
      this.heartbeatState.maxDurationReached = true;
      if (this.config.debug) {
        const tierResult = this.getCurrentTier();
        console.log(
          `[Staminads] Heartbeat max duration reached ` +
          `(${Math.round(totalActiveMs / 1000)}s active, tier ${tierResult?.index ?? 0})`
        );
      }
      return true;
    }

    return false;
  }

  /**
   * Get current tier based on active time
   */
  private getCurrentTier(): { tier: HeartbeatTier; index: number } | null {
    if (!this.config) return null;

    const totalActiveMs = this.getTotalActiveMs();
    const tiers = this.config.heartbeatTiers;

    // Find the highest tier that applies (tiers sorted by 'after' ascending)
    let currentTier = tiers[0];
    let currentIndex = 0;

    for (let i = 0; i < tiers.length; i++) {
      if (totalActiveMs >= tiers[i].after) {
        currentTier = tiers[i];
        currentIndex = i;
      } else {
        break;
      }
    }

    return { tier: currentTier, index: currentIndex };
  }

  /**
   * Get current interval based on tier and device type
   */
  private getCurrentInterval(): number | null {
    const result = this.getCurrentTier();
    if (!result) return null;

    const { tier } = result;
    return this.isMobileDevice ? tier.mobileInterval : tier.desktopInterval;
  }

  /**
   * Reset heartbeat state completely
   */
  private resetHeartbeatState(): void {
    this.stopHeartbeat(false);
    this.heartbeatState = {
      activeStartTime: 0,
      accumulatedActiveMs: 0,
      isActive: false,
      maxDurationReached: false,
      lastPingTime: 0,
      currentTierIndex: 0,
      pageActiveMs: 0,
      pageStartTime: Date.now(),
    };
  }

  /**
   * Reset page active time only (for SPA navigation)
   */
  private resetPageActiveTime(): void {
    // Keep session time, reset page time
    this.heartbeatState.pageActiveMs = 0;
    this.heartbeatState.pageStartTime = Date.now();
  }

  /**
   * Validate and normalize heartbeat tiers
   */
  private validateTiers(tiers: HeartbeatTier[]): HeartbeatTier[] {
    if (!tiers || tiers.length === 0) {
      return DEFAULT_HEARTBEAT_TIERS;
    }

    // Sort by 'after' ascending
    const sorted = [...tiers].sort((a, b) => a.after - b.after);

    // Ensure first tier starts at 0
    if (sorted[0].after !== 0) {
      sorted.unshift({
        after: 0,
        desktopInterval: 10000,
        mobileInterval: 7000,
      });
    }

    // Enforce minimum intervals
    return sorted.map((tier) => ({
      ...tier,
      desktopInterval:
        tier.desktopInterval === null
          ? null
          : Math.max(tier.desktopInterval, MIN_HEARTBEAT_INTERVAL),
      mobileInterval:
        tier.mobileInterval === null
          ? null
          : Math.max(tier.mobileInterval, MIN_HEARTBEAT_INTERVAL),
    }));
  }

  /**
   * Schedule a debounced send (for rapid navigations)
   */
  private scheduleDebouncedSend(): void {
    if (this.sendDebounceTimeout) {
      clearTimeout(this.sendDebounceTimeout);
    }

    this.sendDebounceTimeout = setTimeout(async () => {
      this.sendDebounceTimeout = null;
      await this.sendPayload();
    }, SEND_DEBOUNCE_MS);
  }

  /**
   * Send session payload to server
   */
  private async sendPayload(): Promise<void> {
    if (!this.sessionState || !this.sender) return;

    const attributes = this.buildAttributes();
    const payload = this.sessionState.buildPayload(attributes);

    const result = await this.sender.sendSession(payload);

    if (result.success) {
      // Mark attributes as sent after first successful send
      if (!this.sessionState.hasAttributesSent()) {
        this.sessionState.markAttributesSent();
      }

      // Apply checkpoint from server
      if (result.checkpoint !== undefined) {
        this.sessionState.applyCheckpoint(result.checkpoint);
      }

      // Persist updated state
      this.sessionState.persist();
    }
  }

  /**
   * Build session attributes from current state
   */
  private buildAttributes(): SessionAttributes {
    const session = this.sessionManager?.getSession();
    const device = this.deviceInfo;

    return {
      landing_page: session?.landing_page || window.location.href,
      referrer: session?.referrer || undefined,
      utm_source: session?.utm?.source || undefined,
      utm_medium: session?.utm?.medium || undefined,
      utm_campaign: session?.utm?.campaign || undefined,
      utm_term: session?.utm?.term || undefined,
      utm_content: session?.utm?.content || undefined,
      utm_id: session?.utm?.id || undefined,
      utm_id_from: session?.utm?.id_from || undefined,
      screen_width: device?.screen_width,
      screen_height: device?.screen_height,
      viewport_width: device?.viewport_width,
      viewport_height: device?.viewport_height,
      device: device?.device,
      browser: device?.browser,
      browser_type: device?.browser_type || undefined,
      os: device?.os,
      user_agent: device?.user_agent,
      connection_type: device?.connection_type,
      language: device?.language,
      timezone: device?.timezone,
    };
  }

  // Public API

  /**
   * Get session ID
   */
  async getSessionId(): Promise<string> {
    await this.ensureInitialized();
    return this.sessionManager?.getSessionId() || '';
  }

  /**
   * Get visitor ID
   */
  async getVisitorId(): Promise<string> {
    await this.ensureInitialized();
    return this.sessionManager?.getVisitorId() || '';
  }

  /**
   * Get focus duration in milliseconds
   * In V3, this is calculated from completed pageview durations + current page time
   */
  async getFocusDuration(): Promise<number> {
    await this.ensureInitialized();
    if (!this.sessionState) return 0;

    // Sum completed pageview durations
    const actions = this.sessionState.getActions();
    let total = 0;
    for (const action of actions) {
      if (action.type === 'pageview') {
        total += action.duration;
      }
    }

    // Add current page time
    const currentPage = this.sessionState.getCurrentPage();
    if (currentPage) {
      total += Date.now() - currentPage.entered_at;
    }

    return total;
  }

  /**
   * Get total duration in milliseconds
   */
  async getTotalDuration(): Promise<number> {
    await this.ensureInitialized();
    const session = this.sessionManager?.getSession();
    if (!session) return 0;
    return Date.now() - session.created_at;
  }

  /**
   * Track page view
   */
  async trackPageView(url?: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.sessionState) return;

    // Update scroll before navigation
    if (this.scrollTracker) {
      this.sessionState.updateScroll(this.scrollTracker.getMaxScrollPercent());
    }

    const path = url || window.location.pathname;
    this.sessionState.addPageview(path);

    // Reset scroll tracking
    this.scrollTracker?.reset();

    // Reset page timer
    this.resetPageActiveTime();

    // Debounced send
    this.scheduleDebouncedSend();

    // Persist state
    this.sessionState.persist();
  }

  /**
   * Track goal (immediate send)
   */
  async trackGoal(data: GoalData): Promise<void> {
    await this.ensureInitialized();
    if (!this.sessionState) return;

    // Add goal to SessionState
    this.sessionState.addGoal(data.action, data.value, data.properties);

    // Cancel any pending debounced send
    if (this.sendDebounceTimeout) {
      clearTimeout(this.sendDebounceTimeout);
      this.sendDebounceTimeout = null;
    }

    // Immediate send for goals (critical for conversion timing)
    await this.sendPayload();

    // Persist state
    this.sessionState.persist();
  }

  /**
   * Set custom dimension
   */
  async setDimension(index: number, value: string): Promise<void> {
    await this.ensureInitialized();
    this.sessionManager?.setDimension(index, value);
  }

  /**
   * Set multiple dimensions
   */
  async setDimensions(dimensions: Record<number, string>): Promise<void> {
    await this.ensureInitialized();
    this.sessionManager?.setDimensions(dimensions);
  }

  /**
   * Get dimension value
   */
  async getDimension(index: number): Promise<string | null> {
    await this.ensureInitialized();
    return this.sessionManager?.getDimension(index) || null;
  }

  /**
   * Clear all dimensions
   */
  async clearDimensions(): Promise<void> {
    await this.ensureInitialized();
    this.sessionManager?.clearDimensions();
  }

  /**
   * Pause tracking
   */
  async pause(): Promise<void> {
    await this.ensureInitialized();
    this.isPaused = true;
    this.stopHeartbeat(true); // Accumulate time
  }

  /**
   * Resume tracking
   */
  async resume(): Promise<void> {
    await this.ensureInitialized();
    this.isPaused = false;

    // Reset max duration flag on explicit resume (allows user to restart tracking)
    this.resetHeartbeatState();
    this.startHeartbeat();
  }

  /**
   * Reset session
   */
  async reset(): Promise<void> {
    await this.ensureInitialized();
    if (!this.sessionManager || !this.config) return;

    // Create new session
    this.sessionManager.reset();
    const session = this.sessionManager.getOrCreateSession();

    // Reinitialize SessionState with new session
    const sessionStateConfig: SessionStateConfig = {
      workspace_id: this.config.workspace_id,
      session_id: session.id,
      created_at: session.created_at,
    };
    this.sessionState = new SessionState(sessionStateConfig);
    this.sessionState.addPageview(window.location.pathname);

    // Reset scroll and heartbeat
    this.scrollTracker?.reset();
    this.resetHeartbeatState();
    this.startHeartbeat();

    // Send initial payload for new session
    await this.sendPayload();
  }

  /**
   * Get current configuration (defensive copy)
   */
  getConfig(): Readonly<StaminadsConfig> | null {
    if (!this.config) return null;
    return { ...this.config };
  }

  /**
   * Get debug info
   */
  debug(): SessionDebugInfo {
    return {
      session: this.sessionManager?.getSession() || null,
      config: this.config,
      isTracking: this.isTracking,
      actionsCount: this.sessionState?.getActions().length || 0,
      checkpoint: this.sessionState?.getCheckpoint() || -1,
      currentPage: this.sessionState?.getCurrentPage()?.path || null,
    };
  }

  /**
   * Decorate URL with cross-domain session params
   * Use this for programmatic navigation (window.location.href, window.open)
   */
  async decorateUrl(url: string): Promise<string> {
    await this.ensureInitialized();
    if (!this.crossDomainLinker) {
      return url; // Return unchanged if cross-domain not configured
    }
    return this.crossDomainLinker.decorateUrl(url);
  }

  /**
   * Ensure SDK is initialized (awaits init promise if needed)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.initPromise) {
      throw new Error('Staminads not configured. Set window.StaminadsConfig before loading the SDK.');
    }

    await this.initPromise;
  }
}
