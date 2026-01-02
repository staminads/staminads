/**
 * Staminads SDK v5.0
 * Ultra-reliable web analytics for tracking TimeScore metrics
 */

import type {
  StaminadsConfig,
  InternalConfig,
  TrackEventPayload,
  ConversionData,
  SessionDebugInfo,
  DeviceInfo,
  EventName,
  HeartbeatTier,
  HeartbeatState,
} from './types';
import { Storage, TabStorage } from './storage/storage';
import { SessionManager } from './core/session';
import { DurationTracker } from './core/duration';
import { Sender } from './transport/sender';
import { DeviceDetector } from './detection/device';
import { ScrollTracker } from './events/scroll';
import { NavigationTracker } from './events/navigation';
import { isBot } from './detection/bot';
import { parseReferrer, DEFAULT_AD_CLICK_IDS } from './utils/utm';

const SDK_VERSION = '5.0.0';

// Heartbeat constants
const MIN_HEARTBEAT_INTERVAL = 5000; // 5 seconds minimum
const MIN_HEARTBEAT_MAX_DURATION = 60 * 1000; // 1 minute minimum

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
  anonymizeIP: false,
  trackSPA: true,
  trackScroll: true,
  trackClicks: false,
  heartbeatTiers: DEFAULT_HEARTBEAT_TIERS,
  heartbeatMaxDuration: 10 * 60 * 1000, // 10 minutes
  resetHeartbeatOnNavigation: false,
};

export class StaminadsSDK {
  private config: InternalConfig | null = null;
  private storage: Storage | null = null;
  private tabStorage: TabStorage | null = null;
  private sessionManager: SessionManager | null = null;
  private durationTracker: DurationTracker | null = null;
  private sender: Sender | null = null;
  private deviceDetector: DeviceDetector | null = null;
  private scrollTracker: ScrollTracker | null = null;
  private navigationTracker: NavigationTracker | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
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
  private flushed = false;

  /**
   * Initialize the SDK
   */
  async init(userConfig: StaminadsConfig): Promise<void> {
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

    // Initialize session manager
    this.sessionManager = new SessionManager(
      this.storage,
      this.tabStorage,
      this.config
    );
    this.sessionManager.getOrCreateSession();

    // Initialize duration tracker
    this.durationTracker = new DurationTracker(this.config.debug);
    this.durationTracker.setTickCallback(() => this.onTick());

    // Restore duration if session was resumed
    const session = this.sessionManager.getSession();
    if (session && session.focus_duration_ms > 0) {
      this.durationTracker.setAccumulatedDuration(session.focus_duration_ms);
    }

    // Initialize sender
    this.sender = new Sender(this.config.endpoint, this.storage, this.config.debug);

    // Initialize scroll tracker
    if (this.config.trackScroll) {
      this.scrollTracker = new ScrollTracker();
      this.scrollTracker.setMilestoneCallback((percent) => this.onScrollMilestone(percent));
      this.scrollTracker.start();
    }

    // Initialize navigation tracker
    if (this.config.trackSPA) {
      this.navigationTracker = new NavigationTracker();
      this.navigationTracker.setNavigationCallback((url) => this.onNavigation(url));
      this.navigationTracker.start();
    }

    // Bind events
    this.bindEvents();

    // Start tracking
    this.isTracking = true;
    this.isInitialized = true;
    this.durationTracker.startFocus();

    // Initialize heartbeat state
    const now = Date.now();
    this.heartbeatState.pageStartTime = now;
    this.heartbeatState.activeStartTime = now;

    // Start heartbeat
    this.startHeartbeat();

    // Send initial screen_view
    this.sendEvent('screen_view');

    // Flush any pending queue
    this.sender.flushQueue();

    if (this.config.debug) {
      console.log('[Staminads] Initialized', {
        session_id: this.sessionManager.getSessionId(),
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

    // Online/offline
    window.addEventListener('online', this.onOnline);
  }

  /**
   * Visibility change handler
   */
  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.durationTracker?.hideFocus();
      this.stopHeartbeat(true); // Accumulate active time
      this.flushOnce();
    } else if (document.visibilityState === 'visible') {
      this.flushed = false;
      if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
        this.durationTracker?.resumeFocus();
        // Resume heartbeat with fresh timing
        this.resumeHeartbeat();
      }
      // Flush any pending queue when page becomes visible again
      this.sender?.flushQueue();
    }
  };

  /**
   * Window focus handler
   */
  private onFocus = (): void => {
    this.flushed = false;
    if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
      this.durationTracker?.resumeFocus();
      this.resumeHeartbeat();
    }
    this.sender?.flushQueue();
  };

  /**
   * Window blur handler
   */
  private onBlur = (): void => {
    this.durationTracker?.pauseFocus();
    this.stopHeartbeat(true); // Accumulate active time
    this.flushOnce();
  };

  /**
   * Page freeze handler (mobile)
   */
  private onFreeze = (): void => {
    this.durationTracker?.hideFocus();
    this.stopHeartbeat(true); // Accumulate active time
    this.flushOnce();
  };

  /**
   * Page resume handler (mobile)
   */
  private onResume = (): void => {
    this.flushed = false;
    if (!this.isPaused && !this.heartbeatState.maxDurationReached) {
      this.durationTracker?.resumeFocus();
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
        this.durationTracker?.resumeFocus();
        this.resumeHeartbeat();
      }
      if (this.config?.debug) {
        console.log('[Staminads] Restored from bfcache');
      }
    }
  };

  /**
   * Online handler
   */
  private onOnline = (): void => {
    this.sender?.flushQueue();
  };

  /**
   * Flush once (deduplicate unload events)
   */
  private flushOnce(): void {
    if (this.flushed) return;
    this.flushed = true;
    this.updateSession();
    this.sendEvent('ping');
  }

  /**
   * Tick callback (every second while focused)
   */
  private onTick(): void {
    this.updateSession();
  }

  /**
   * Navigation callback
   */
  private onNavigation(url: string): void {
    if (this.config?.debug) {
      console.log('[Staminads] Navigation:', url);
    }

    // Reset scroll tracking for new page
    this.scrollTracker?.reset();

    // Always reset page active time on navigation
    this.resetPageActiveTime();

    // Optionally reset session heartbeat timer
    if (this.config?.resetHeartbeatOnNavigation) {
      this.resetHeartbeatState();
      this.startHeartbeat();
    }

    // Send screen_view for new page
    this.sendEvent('screen_view');
  }

  /**
   * Scroll milestone callback
   */
  private onScrollMilestone(percent: number): void {
    if (this.config?.debug) {
      console.log('[Staminads] Scroll milestone:', percent);
    }
    this.sendEvent('scroll');
  }

  /**
   * Update session state
   */
  private updateSession(): void {
    if (!this.sessionManager || !this.durationTracker) return;

    this.sessionManager.updateSession({
      focus_duration_ms: this.durationTracker.getFocusDurationMs(),
      total_duration_ms: Date.now() - (this.sessionManager.getSession()?.created_at || Date.now()),
      max_scroll_percent: this.scrollTracker?.getMaxScrollPercent() || 0,
    });
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

        // Send ping with tier metadata
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
   * Send ping event with tier metadata.
   */
  private sendPingEvent(): void {
    const tierResult = this.getCurrentTier();
    const totalActiveMs = this.getTotalActiveMs();
    const pageActiveMs = this.getPageActiveMs();

    this.sendEvent('ping', {
      tier: String(tierResult?.index ?? 0),
      active_time: String(Math.round(totalActiveMs / 1000)),
      page_active_time: String(Math.round(pageActiveMs / 1000)),
    });
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
   * Get page active time in milliseconds
   */
  private getPageActiveMs(): number {
    let total = this.heartbeatState.pageActiveMs;
    if (this.heartbeatState.isActive) {
      total += Date.now() - this.heartbeatState.pageStartTime;
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
   * Send event
   */
  private sendEvent(name: EventName, properties?: Record<string, string>): void {
    if (!this.isTracking || !this.sessionManager || !this.sender || !this.config) {
      return;
    }

    const session = this.sessionManager.getSession();
    if (!session) return;

    const referrerInfo = parseReferrer(session.referrer || '');

    const payload: TrackEventPayload = {
      // Required
      workspace_id: session.workspace_id,
      session_id: session.id,
      name,
      path: window.location.pathname,
      landing_page: session.landing_page,

      // Traffic source
      referrer: session.referrer || undefined,
      referrer_domain: referrerInfo.domain || undefined,
      referrer_path: referrerInfo.path || undefined,

      // UTM
      utm_source: session.utm?.source || undefined,
      utm_medium: session.utm?.medium || undefined,
      utm_campaign: session.utm?.campaign || undefined,
      utm_term: session.utm?.term || undefined,
      utm_content: session.utm?.content || undefined,
      utm_id: session.utm?.id || undefined,
      utm_id_from: session.utm?.id_from || undefined,

      // Device
      screen_width: this.deviceInfo?.screen_width,
      screen_height: this.deviceInfo?.screen_height,
      viewport_width: this.deviceInfo?.viewport_width,
      viewport_height: this.deviceInfo?.viewport_height,
      device: this.deviceInfo?.device,
      browser: this.deviceInfo?.browser,
      browser_type: this.deviceInfo?.browser_type,
      os: this.deviceInfo?.os,
      user_agent: this.deviceInfo?.user_agent,
      connection_type: this.deviceInfo?.connection_type,

      // Locale
      language: this.deviceInfo?.language,
      timezone: this.deviceInfo?.timezone,

      // Engagement
      duration: this.durationTracker?.getFocusDurationSeconds() || 0,
      max_scroll: this.scrollTracker?.getMaxScrollPercent() || 0,

      // SDK
      sdk_version: SDK_VERSION,
      tab_id: this.sessionManager.getTabId(),
      sent_at: Date.now(),

      // Custom dimensions
      ...this.sessionManager.getDimensionsPayload(),

      // Spread properties at top level for easier access
      ...properties,
    };

    // Remove undefined values
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([_, v]) => v !== undefined)
    ) as TrackEventPayload;

    this.sender.send(cleanPayload);
  }

  // Public API

  /**
   * Get session ID
   */
  getSessionId(): string {
    this.ensureInitialized();
    return this.sessionManager?.getSessionId() || '';
  }

  /**
   * Get visitor ID
   */
  getVisitorId(): string {
    this.ensureInitialized();
    return this.sessionManager?.getVisitorId() || '';
  }

  /**
   * Get focus duration in milliseconds
   */
  getFocusDuration(): number {
    this.ensureInitialized();
    return this.durationTracker?.getFocusDurationMs() || 0;
  }

  /**
   * Get total duration in milliseconds
   */
  getTotalDuration(): number {
    this.ensureInitialized();
    const session = this.sessionManager?.getSession();
    if (!session) return 0;
    return Date.now() - session.created_at;
  }

  /**
   * Track page view
   */
  trackPageView(url?: string): void {
    this.ensureInitialized();
    if (url) {
      // Update navigation tracker
      window.history.pushState({}, '', url);
    }
    this.sendEvent('screen_view');
  }

  /**
   * Track custom event
   */
  trackEvent(name: string, properties?: Record<string, string>): void {
    this.ensureInitialized();
    this.sendEvent('ping', { event_name: name, ...properties });
  }

  /**
   * Track conversion
   */
  trackConversion(data: ConversionData): void {
    this.ensureInitialized();

    const properties: Record<string, string> = {
      conversion_name: data.action,
    };

    if (data.id) properties.conversion_id = data.id;
    if (data.value !== undefined) properties.conversion_value = String(data.value);
    if (data.currency) properties.conversion_currency = data.currency;
    if (data.properties) Object.assign(properties, data.properties);

    this.sendEvent('conversion', properties);
  }

  /**
   * Set custom dimension
   */
  setDimension(index: number, value: string): void {
    this.ensureInitialized();
    this.sessionManager?.setDimension(index, value);
  }

  /**
   * Set multiple dimensions
   */
  setDimensions(dimensions: Record<number, string>): void {
    this.ensureInitialized();
    this.sessionManager?.setDimensions(dimensions);
  }

  /**
   * Get dimension value
   */
  getDimension(index: number): string | null {
    this.ensureInitialized();
    return this.sessionManager?.getDimension(index) || null;
  }

  /**
   * Clear all dimensions
   */
  clearDimensions(): void {
    this.ensureInitialized();
    this.sessionManager?.clearDimensions();
  }

  /**
   * Pause tracking
   */
  pause(): void {
    this.ensureInitialized();
    this.isPaused = true;
    this.durationTracker?.pauseFocus();
    this.stopHeartbeat(true); // Accumulate time
  }

  /**
   * Resume tracking
   */
  resume(): void {
    this.ensureInitialized();
    this.isPaused = false;
    this.durationTracker?.resumeFocus();

    // Reset max duration flag on explicit resume (allows user to restart tracking)
    this.resetHeartbeatState();
    this.startHeartbeat();
  }

  /**
   * Reset session
   */
  reset(): void {
    this.ensureInitialized();
    if (!this.sessionManager) return;

    this.sessionManager.reset();
    this.durationTracker?.reset();
    this.scrollTracker?.reset();
    this.resetHeartbeatState();
    this.startHeartbeat();
    this.sendEvent('screen_view');
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
      focusState: this.durationTracker?.getState() || 'FOCUSED',
      isTracking: this.isTracking,
      queueLength: this.sender?.getQueueLength() || 0,
    };
  }

  /**
   * Ensure SDK is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Staminads must be initialized before use. Call Staminads.init() first.');
    }
  }
}
