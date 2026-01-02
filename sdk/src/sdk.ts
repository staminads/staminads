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

// Default configuration
const DEFAULT_CONFIG: Omit<InternalConfig, 'workspace_id' | 'endpoint'> = {
  debug: false,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  heartbeatInterval: 10000, // 10 seconds
  adClickIds: DEFAULT_AD_CLICK_IDS,
  anonymizeIP: false,
  trackSPA: true,
  trackScroll: true,
  trackClicks: false,
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
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
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

    // Initialize storage
    this.storage = new Storage();
    this.tabStorage = new TabStorage();

    // Initialize device detector
    this.deviceDetector = new DeviceDetector();
    this.deviceInfo = await this.deviceDetector.detectWithClientHints();

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
      this.flushOnce();
    } else if (document.visibilityState === 'visible') {
      this.flushed = false;
      if (!this.isPaused) {
        this.durationTracker?.resumeFocus();
      }
    }
  };

  /**
   * Window focus handler
   */
  private onFocus = (): void => {
    this.flushed = false;
    if (!this.isPaused) {
      this.durationTracker?.resumeFocus();
    }
    this.sender?.flushQueue();
  };

  /**
   * Window blur handler
   */
  private onBlur = (): void => {
    this.durationTracker?.pauseFocus();
    this.flushOnce();
  };

  /**
   * Page freeze handler (mobile)
   */
  private onFreeze = (): void => {
    this.durationTracker?.hideFocus();
    this.flushOnce();
  };

  /**
   * Page resume handler (mobile)
   */
  private onResume = (): void => {
    this.flushed = false;
    if (!this.isPaused) {
      this.durationTracker?.resumeFocus();
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
      if (!this.isPaused) {
        this.durationTracker?.resumeFocus();
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
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (!this.config) return;

    // Desktop: 10 seconds, Mobile: 7 seconds
    const isMobile = this.deviceInfo?.device !== 'desktop';
    const interval = isMobile ? 7000 : this.config.heartbeatInterval;

    this.heartbeatInterval = setInterval(() => {
      if (!this.isPaused && this.isTracking) {
        this.sendEvent('ping');
      }
    }, interval);
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

      // Custom dimensions
      ...this.sessionManager.getDimensionsPayload(),

      // Properties
      properties,
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
      action: data.action,
    };

    if (data.id) properties.conversion_id = data.id;
    if (data.value !== undefined) properties.value = String(data.value);
    if (data.currency) properties.currency = data.currency;
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

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Resume tracking
   */
  resume(): void {
    this.ensureInitialized();
    this.isPaused = false;
    this.durationTracker?.resumeFocus();
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
    this.sendEvent('screen_view');
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
