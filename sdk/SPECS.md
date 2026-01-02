# Staminads SDK v5.0 - SOTA 2025 Specifications

## Mission Critical Requirements

**Zero Data Loss**: Every session MUST be captured and transmitted. No exceptions.
**Exact Duration**: Focus time must be measured with millisecond precision, counting only truly active engagement.

---

## 1. Architecture

### 1.1 Design Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                    RELIABILITY FIRST                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Fail-safe storage: localStorage → Memory fallback           │
│  2. Multi-channel transmission: Beacon → Fetch → Queue          │
│  3. Offline-first: Store-and-forward with automatic retry       │
│  4. Redundant events: Multiple triggers for critical sends      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Module Structure

```
sdk/
├── src/
│   ├── index.ts                 # Main entry, public API
│   ├── core/
│   │   ├── session.ts           # Session lifecycle management
│   │   ├── duration.ts          # Precise duration tracking
│   │   ├── focus.ts             # Focus state machine
│   │   └── identity.ts          # Session/visitor ID generation
│   ├── storage/
│   │   └── storage.ts           # localStorage + memory fallback
│   ├── transport/
│   │   ├── sender.ts            # Unified send orchestrator
│   │   ├── beacon.ts            # navigator.sendBeacon
│   │   ├── fetch.ts             # fetch with keepalive
│   │   └── queue.ts             # Offline queue with retry
│   ├── events/
│   │   ├── visibility.ts        # Page Visibility API
│   │   ├── lifecycle.ts         # Page lifecycle (freeze, resume)
│   │   ├── navigation.ts        # SPA router detection
│   │   └── engagement.ts        # Scroll, clicks, interactions
│   ├── detection/
│   │   ├── bot.ts               # Bot/crawler detection
│   │   ├── environment.ts       # Browser capability detection
│   │   └── device.ts            # Device type classification
│   └── utils/
│       ├── time.ts              # High-precision timing
│       ├── uuid.ts              # Crypto-secure UUID generation
│       └── throttle.ts          # Performance utilities
├── dist/                        # Built output
│   ├── staminads.min.js         # UMD bundle (production)
│   ├── staminads.esm.js         # ES Module
│   ├── staminads.cjs.js         # CommonJS
│   └── staminads.d.ts           # TypeScript definitions
├── tests/
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # Browser E2E tests
└── package.json
```

---

## 2. Session Management

### 2.1 Session Lifecycle

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   CREATED    │───▶│   ACTIVE     │───▶│   ENDED      │
└──────────────┘    └──────────────┘    └──────────────┘
       │                   │                    │
       │                   ▼                    │
       │            ┌──────────────┐            │
       │            │   PAUSED     │            │
       │            └──────────────┘            │
       │                   │                    │
       ▼                   ▼                    ▼
  [Store + Send]     [Store + Send]      [Final Send]
```

### 2.2 Session Data Model

```typescript
interface Session {
  // Identity
  id: string;                    // UUIDv7 (time-sortable)
  visitor_id: string;            // Persistent visitor identifier
  workspace_id: string;          // Workspace/site identifier

  // Timing (all in milliseconds for precision)
  created_at: number;            // Session start timestamp
  updated_at: number;            // Last update timestamp
  ended_at: number | null;       // Session end timestamp

  // Duration tracking
  focus_duration_ms: number;     // Total focused/active time
  total_duration_ms: number;     // Wall clock time since creation

  // Traffic source
  referrer: string | null;       // document.referrer
  landing_page: string;          // Initial URL
  utm: UTMParams | null;         // Parsed UTM parameters

  // Context
  pages: PageView[];             // All pages visited (SPA support)
  device: DeviceInfo;            // Device classification
  geo: GeoInfo | null;           // From server-side enrichment

  // Engagement
  max_scroll_percent: number;    // Deepest scroll (0-100)
  interaction_count: number;     // Clicks, keypresses, touches

  // Meta
  sdk_version: string;           // SDK version
  sequence: number;              // Update sequence number
}

interface PageView {
  url: string;
  title: string;
  entered_at: number;
  exited_at: number | null;
  focus_duration_ms: number;
  max_scroll_percent: number;
}

interface UTMParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

interface DeviceInfo {
  // Screen dimensions
  screen_width: number;           // window.screen.width
  screen_height: number;          // window.screen.height
  viewport_width: number;         // window.innerWidth
  viewport_height: number;        // window.innerHeight

  // Parsed from User Agent (using ua-parser-js)
  device: 'desktop' | 'mobile' | 'tablet';
  browser: string;                // Chrome, Safari, Firefox, Edge, etc.
  browser_type: string | null;    // crawler, inapp, email, fetcher, cli, mediaplayer, module, or null
  os: string;                     // macOS, Windows, iOS, iPadOS, Android, Linux, etc.
  user_agent: string;             // Raw user agent string

  // Network
  connection_type: string;        // 4g, 3g, 2g, slow-2g, or empty

  // Locale
  timezone: string;               // IANA timezone (Intl.DateTimeFormat)
  language: string;               // BCP 47 language tag (navigator.language)
}
```

### 2.3 Session Identification

```typescript
// Visitor ID: Persistent across sessions
// - Stored in localStorage with 1-year expiry
// - Fallback to first-party cookie if localStorage blocked
// - UUIDv4 format

// Session ID: Per-session, time-sortable
// - UUIDv7 format (timestamp + random)
// - Enables chronological sorting without additional fields
// - Regenerated on:
//   1. First page load without existing session
//   2. Session timeout (configurable, default 30 min inactivity)
//   3. Midnight crossing (new day = new session)
```

---

## 3. Duration Tracking (CRITICAL)

### 3.1 Focus State Machine

```
                    ┌─────────────────────────────────────┐
                    │         FOCUS STATE MACHINE         │
                    └─────────────────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
       ┌──────────┐           ┌──────────┐           ┌──────────┐
       │  FOCUSED │           │  BLURRED │           │  HIDDEN  │
       │ (active) │           │ (passive)│           │(inactive)│
       └──────────┘           └──────────┘           └──────────┘
              │                      │                      │
              │    ┌─────────────────┼─────────────────┐    │
              ▼    ▼                 ▼                 ▼    ▼
         [COUNTING]            [NOT COUNTING]         [NOT COUNTING]
         focus_duration++      (paused)               (paused)
```

### 3.2 Focus Detection Events

```typescript
// PRIMARY: Page Visibility API (most reliable)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resumeFocusTracking();
  } else {
    pauseFocusTracking();
    flushData(); // Critical: send on hide
  }
});

// SECONDARY: Window focus/blur (catches alt-tab, window switches)
window.addEventListener('focus', resumeFocusTracking);
window.addEventListener('blur', () => {
  pauseFocusTracking();
  flushData();
});

// TERTIARY: Page Lifecycle API (modern browsers)
document.addEventListener('freeze', () => {
  pauseFocusTracking();
  flushData();
});
document.addEventListener('resume', resumeFocusTracking);

// QUATERNARY: Pointer/interaction detection (idle detection)
// If no interaction for X seconds while "focused", consider idle
const IDLE_THRESHOLD_MS = 60000; // 1 minute
```

### 3.3 High-Precision Timing

```typescript
class DurationTracker {
  private focusStartTime: number | null = null;
  private accumulatedFocusMs: number = 0;
  private lastTickTime: number = 0;
  private tickInterval: number | null = null;

  // Use performance.now() for sub-millisecond precision
  private now(): number {
    return performance.now();
  }

  // Convert to wall-clock for storage
  private toTimestamp(): number {
    return Date.now();
  }

  startFocus(): void {
    if (this.focusStartTime !== null) return; // Already focused
    this.focusStartTime = this.now();
    this.lastTickTime = this.focusStartTime;
    this.startTicking();
  }

  pauseFocus(): void {
    if (this.focusStartTime === null) return; // Not focused
    const elapsed = this.now() - this.focusStartTime;
    this.accumulatedFocusMs += elapsed;
    this.focusStartTime = null;
    this.stopTicking();
  }

  // Tick every second to persist progress
  // Prevents data loss if browser crashes
  private startTicking(): void {
    this.tickInterval = window.setInterval(() => {
      this.tick();
    }, 1000);
  }

  private tick(): void {
    if (this.focusStartTime === null) return;

    const now = this.now();
    const delta = now - this.lastTickTime;
    this.lastTickTime = now;

    // Detect anomalies (system sleep, throttling)
    if (delta > 5000) {
      // Gap detected - system was likely sleeping
      // Don't count this time
      console.warn(`[Staminads] Time gap detected: ${delta}ms`);
      this.focusStartTime = now; // Reset focus start
      return;
    }

    // Persist current state
    this.persistState();
  }

  getFocusDurationMs(): number {
    let total = this.accumulatedFocusMs;
    if (this.focusStartTime !== null) {
      total += this.now() - this.focusStartTime;
    }
    return Math.round(total);
  }
}
```

### 3.4 Edge Cases Handled

| Scenario | Detection | Handling |
|----------|-----------|----------|
| Tab switch | `visibilitychange` | Pause + flush |
| Alt-tab | `blur` event | Pause + flush |
| Screen lock | `visibilitychange` | Pause + flush |
| System sleep | Time gap > 5s | Discard gap, resume |
| Browser throttling | Tick delta check | Adjust accordingly |
| Page freeze (mobile) | `freeze` event | Pause + flush |
| Back/forward cache | `pageshow` event | Resume session |
| SPA navigation | History API hooks | Track as new page |
| Iframe focus | `blur` without `visibilitychange` | Pause (conservative) |
| DevTools open | No direct detection | Continue counting (user activity) |
| Print dialog | `blur` event | Pause |
| Alert/confirm | `blur` event | Pause |

---

## 4. Data Transmission (ZERO LOSS)

### 4.1 Multi-Channel Strategy

```typescript
async function sendData(payload: Payload): Promise<boolean> {
  const data = JSON.stringify(payload);
  const url = `${config.endpoint}/collect`;

  // Strategy 1: Beacon API (survives page unload)
  if (navigator.sendBeacon) {
    const blob = new Blob([data], { type: 'application/json' });
    if (navigator.sendBeacon(url, blob)) {
      return true;
    }
  }

  // Strategy 2: Fetch with keepalive (survives page unload)
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: data,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    });
    if (response.ok) return true;
  } catch (e) {
    // Continue to fallback
  }

  // Strategy 3: Queue for retry
  await queueForRetry(payload);
  return false;
}
```

### 4.2 Offline Queue (localStorage)

```typescript
interface QueuedPayload {
  id: string;
  payload: Payload;
  created_at: number;
  attempts: number;
  last_attempt: number | null;
}

class OfflineQueue {
  private storage: Storage;
  private readonly STORAGE_KEY = 'pending';
  private readonly MAX_ITEMS = 50;           // Limit queue size
  private readonly MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_ATTEMPTS = 5;

  add(payload: Payload): void {
    const queue = this.getQueue();

    // Limit queue size to prevent localStorage quota issues
    if (queue.length >= this.MAX_ITEMS) {
      queue.shift(); // Remove oldest
    }

    queue.push({
      id: generateUUID(),
      payload,
      created_at: Date.now(),
      attempts: 0,
      last_attempt: null,
    });

    this.storage.set(this.STORAGE_KEY, queue);
  }

  flush(): void {
    const queue = this.getQueue();
    const remaining: QueuedPayload[] = [];

    for (const item of queue) {
      // Skip if too old
      if (Date.now() - item.created_at > this.MAX_AGE_MS) {
        continue;
      }

      // Skip if too many attempts
      if (item.attempts >= this.MAX_ATTEMPTS) {
        continue;
      }

      // Exponential backoff
      const backoff = Math.min(1000 * Math.pow(2, item.attempts), 30000);
      if (item.last_attempt && Date.now() - item.last_attempt < backoff) {
        remaining.push(item);
        continue;
      }

      // Try to send
      item.attempts++;
      item.last_attempt = Date.now();

      const success = sendDirect(item.payload);
      if (!success) {
        remaining.push(item);
      }
    }

    this.storage.set(this.STORAGE_KEY, remaining);
  }

  private getQueue(): QueuedPayload[] {
    return this.storage.get<QueuedPayload[]>(this.STORAGE_KEY) || [];
  }
}

// Flush triggers
window.addEventListener('online', () => queue.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    queue.flush();
  }
});
```

### 4.3 Send Triggers

```typescript
// CRITICAL SENDS (immediate, redundant)
const CRITICAL_EVENTS = [
  'visibilitychange',  // Tab hidden
  'pagehide',          // Navigation away
  'beforeunload',      // Page closing
  'freeze',            // Mobile freeze
];

// HEARTBEAT SENDS (tiered intervals, active time only)
// Tier 0 (0-3 min):   10s (desktop) / 7s (mobile)  - High frequency
// Tier 1 (3-5 min):   20s (desktop) / 14s (mobile) - Medium frequency
// Tier 2 (5-10 min):  30s (desktop) / 21s (mobile) - Low frequency
// 10+ min:            STOPPED
//
// Features:
// - Timer tracks ACTIVE time only (pauses when tab hidden)
// - Drift compensation ensures accurate tier transitions
// - Ping metadata includes tier index and active times
// - Critical sends continue after heartbeat stops

// MILESTONE SENDS (engagement thresholds)
// - First 5 seconds of focus
// - 30 seconds of focus
// - 60 seconds of focus
// - Every 60 seconds thereafter
// - Scroll milestones: 25%, 50%, 75%, 100%
```

---

## 5. Storage Strategy (Simplified)

### 5.1 localStorage with Memory Fallback

Following the KISS principle (like Google Analytics, Mixpanel, Amplitude), we use simple localStorage with memory fallback.

```typescript
class Storage {
  private prefix = 'stm_';
  private memory = new Map<string, any>();

  get<T>(key: string): T | null {
    try {
      const val = localStorage.getItem(this.prefix + key);
      return val ? JSON.parse(val) : null;
    } catch {
      // Private browsing or storage blocked
      return this.memory.get(key) ?? null;
    }
  }

  set<T>(key: string, value: T): void {
    const data = JSON.stringify(value);
    try {
      localStorage.setItem(this.prefix + key, data);
    } catch {
      // Quota exceeded or blocked - use memory fallback
      this.memory.set(key, value);
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      this.memory.delete(key);
    }
  }
}
```

**Why Not IndexedDB?**
- localStorage 5MB quota is sufficient for session data
- Simpler synchronous API
- Major analytics SDKs use localStorage
- IndexedDB adds complexity without significant benefit for this use case

### 5.2 Storage Keys

```typescript
const STORAGE_KEYS = {
  // Session data (localStorage)
  SESSION: 'session',           // Current session object
  VISITOR_ID: 'visitor_id',     // Persistent visitor ID
  PENDING_QUEUE: 'pending',     // Offline queue (max ~50 events)

  // Tab identification (sessionStorage - per-tab)
  TAB_ID: 'tab_id',             // Unique per browser tab
};
```

---

## 6. SPA Support

### 6.1 Router Detection

```typescript
class SPANavigationTracker {
  private currentUrl: string;
  private currentPage: PageView;

  constructor(private onNavigate: (from: PageView, to: string) => void) {
    this.currentUrl = window.location.href;
    this.currentPage = this.createPageView();

    // History API
    this.patchHistory();

    // Popstate (back/forward)
    window.addEventListener('popstate', () => this.handleNavigation());

    // Hash changes
    window.addEventListener('hashchange', () => this.handleNavigation());
  }

  private patchHistory(): void {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.handleNavigation();
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.handleNavigation();
    };
  }

  private handleNavigation(): void {
    const newUrl = window.location.href;
    if (newUrl === this.currentUrl) return;

    // Close current page
    this.currentPage.exited_at = Date.now();

    // Notify
    this.onNavigate(this.currentPage, newUrl);

    // Start new page
    this.currentUrl = newUrl;
    this.currentPage = this.createPageView();
  }

  private createPageView(): PageView {
    return {
      url: window.location.href,
      title: document.title,
      entered_at: Date.now(),
      exited_at: null,
      focus_duration_ms: 0,
      max_scroll_percent: 0,
    };
  }
}
```

---

## 7. User Agent Parsing (ua-parser-js)

### 7.1 Dependency

```json
{
  "dependencies": {
    "ua-parser-js": "^2.0.0"
  }
}
```

### 7.2 Integration

```typescript
import UAParser from 'ua-parser-js';

class DeviceDetector {
  private parser: UAParser;

  constructor() {
    this.parser = new UAParser();
  }

  detect(): DeviceInfo {
    const result = this.parser.getResult();

    return {
      // Screen dimensions
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,

      // Parsed from UA
      device: this.normalizeDeviceType(result.device.type),
      browser: result.browser.name || 'Unknown',
      browser_type: this.getBrowserType(result),
      os: this.normalizeOS(result.os.name, result.device.type),
      user_agent: navigator.userAgent,

      // Network (Navigator.connection API)
      connection_type: this.getConnectionType(),

      // Locale
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    };
  }

  private normalizeDeviceType(type?: string): 'desktop' | 'mobile' | 'tablet' {
    switch (type) {
      case 'mobile':
        return 'mobile';
      case 'tablet':
        return 'tablet';
      default:
        // ua-parser-js returns undefined for desktop
        return 'desktop';
    }
  }

  private normalizeOS(osName?: string, deviceType?: string): string {
    if (!osName) return 'Unknown';

    // Handle iPad specifically (iPadOS vs iOS)
    if (osName === 'iOS' && deviceType === 'tablet') {
      return 'iPadOS';
    }

    // Normalize common OS names to match backend expectations
    const osMap: Record<string, string> = {
      'Mac OS': 'macOS',
      'Windows': 'Windows',
      'iOS': 'iOS',
      'Android': 'Android',
      'Linux': 'Linux',
      'Chrome OS': 'Chrome OS',
      'Ubuntu': 'Linux',
      'Fedora': 'Linux',
      'Debian': 'Linux',
    };

    return osMap[osName] || osName;
  }

  private getBrowserType(result: UAParser.IResult): string | null {
    // Detect special browser types
    const ua = navigator.userAgent.toLowerCase();

    // Crawler/bot detection
    if (/bot|crawler|spider|scraper/i.test(ua)) {
      return 'crawler';
    }

    // In-app browsers
    if (/fbav|fban|instagram|twitter|linkedin|pinterest/i.test(ua)) {
      return 'inapp';
    }

    // Email clients
    if (/thunderbird|outlook/i.test(ua)) {
      return 'email';
    }

    // Headless/fetchers
    if (/headless|phantom|puppeteer|selenium/i.test(ua)) {
      return 'fetcher';
    }

    // CLI tools
    if (/curl|wget|httpie/i.test(ua)) {
      return 'cli';
    }

    // Standard browser
    return null;
  }

  // Network Information API (Chromium-based browsers only)
  // Firefox/Safari return empty string (graceful degradation)
  private getConnectionType(): string {
    const connection = (navigator as any).connection;
    return connection?.effectiveType || ''; // '4g', '3g', '2g', 'slow-2g'
  }
}
```

### 7.3 Bundle Considerations

ua-parser-js adds ~24KB gzipped to the bundle. This is acceptable for accurate device detection including Client Hints support.

### 7.4 Client Hints Integration (Chrome 95+)

Since Chrome 95+, User-Agent strings are **frozen**. Client Hints provide actual values:

| Data | UA String (Frozen) | Client Hints |
|------|-------------------|--------------|
| Windows 10 vs 11 | **Same** | ✅ Distinguishable |
| macOS 10 vs 11 vs 12 | **Same** | ✅ Distinguishable |
| Exact OS version | Frozen to generic | ✅ Available |
| Device model | Limited | ✅ Full model name |

**No User Permission Required**: The `getHighEntropyValues()` API is completely silent - no browser prompts or dialogs.

```typescript
class DeviceDetector {
  private parser: UAParser;

  constructor() {
    this.parser = new UAParser();
  }

  async detectWithClientHints(): Promise<DeviceInfo> {
    try {
      // withClientHints() uses navigator.userAgentData.getHighEntropyValues()
      // This is SILENT - no user prompt/dialog ever shown
      const result = await this.parser.withClientHints();
      return this.mapResult(result);
    } catch {
      // Fallback if blocked by Permissions Policy (silent failure)
      return this.detect(); // Regular UA string parsing
    }
  }

  detect(): DeviceInfo {
    const result = this.parser.getResult();
    return this.mapResult(result);
  }
}
```

**Browser Support**:
| Browser | Client Hints | Fallback |
|---------|-------------|----------|
| Chrome/Edge 90+ | ✅ Full support | - |
| Firefox | ❌ Not implemented | UA string parsing |
| Safari | ❌ Not implemented | UA string parsing |

**Why Client Hints Matter**:
Without Client Hints, you cannot distinguish:
- Windows 10 from Windows 11
- macOS 10, 11, 12, 13, 14
- Exact Android version on newer devices

---

## 8. Bot Detection

### 7.1 Detection Layers

```typescript
function isBot(): boolean {
  // Layer 1: User-agent patterns
  const botPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i,
    /googlebot/i, /bingbot/i, /yandex/i, /baidu/i,
    /duckduck/i, /slurp/i, /msnbot/i, /ia_archiver/i,
    /facebook/i, /twitter/i, /linkedin/i, /pinterest/i,
    /headless/i, /phantom/i, /selenium/i, /puppeteer/i,
    /lighthouse/i, /pagespeed/i, /gtmetrix/i,
  ];

  const ua = navigator.userAgent.toLowerCase();
  if (botPatterns.some(p => p.test(ua))) {
    return true;
  }

  // Layer 2: WebDriver detection
  if (navigator.webdriver) {
    return true;
  }

  // Layer 3: Feature fingerprinting
  const suspiciousFeatures = [
    !('plugins' in navigator) || navigator.plugins.length === 0,
    !('languages' in navigator) || navigator.languages.length === 0,
    !window.chrome && /chrome/i.test(ua), // Fake Chrome
    screen.width === 0 || screen.height === 0,
    !('ontouchstart' in window) && /mobile/i.test(ua), // Fake mobile
  ];

  const suspiciousCount = suspiciousFeatures.filter(Boolean).length;
  if (suspiciousCount >= 3) {
    return true;
  }

  // Layer 4: Behavior analysis (after initialization)
  // - No mouse movements after 30s
  // - No scroll after 30s
  // - Perfect timing patterns (bot-like intervals)

  return false;
}
```

---

## 8. Public API

### 8.1 Initialization

```typescript
interface StaminadsConfig {
  // Required
  workspace_id: string;           // Workspace identifier (required)
  endpoint: string;               // API endpoint (required - no default, OSS solution)

  // Optional
  debug?: boolean;                // Default: false
  sessionTimeout?: number;        // Default: 30 * 60 * 1000 (30 min)
  heartbeatInterval?: number;     // Default: 10000 (10s) - legacy, use heartbeatTiers instead
  adClickIds?: string[];          // URL params to capture as utm_id
                                  // Default: ['gclid', 'fbclid', 'msclkid', 'dclid', 'twclid', 'ttclid', 'li_fat_id', 'wbraid', 'gbraid']

  // Heartbeat (tiered intervals)
  heartbeatTiers?: HeartbeatTier[];  // Tiered interval configuration (see below)
  heartbeatMaxDuration?: number;     // Default: 600000 (10 min). 0 = unlimited.
  resetHeartbeatOnNavigation?: boolean; // Default: false. Reset timer on SPA navigation.

  // Privacy
  anonymizeIP?: boolean;          // Default: false

  // Features
  trackSPA?: boolean;             // Default: true (auto-detect)
  trackScroll?: boolean;          // Default: true
  trackClicks?: boolean;          // Default: false
}

interface HeartbeatTier {
  after: number;                    // Duration threshold in ms (inclusive)
  desktopInterval: number | null;   // Interval for desktop (null = stop)
  mobileInterval: number | null;    // Interval for mobile (null = stop)
}

// Default heartbeat tiers:
// | After    | Desktop | Mobile | Tier |
// |----------|---------|--------|------|
// | 0        | 10s     | 7s     | 0 (High)   |
// | 3 min    | 20s     | 14s    | 1 (Medium) |
// | 5 min    | 30s     | 21s    | 2 (Low)    |
// | 10+ min  | STOPPED | STOPPED| Max duration |

// Initialize
Staminads.init({
  workspace_id: 'ws_abc123',      // required
  endpoint: 'https://your-api.com', // required (no default - OSS)
  debug: true,
});
```

### 8.1.1 Session Management Rules

A new session can ONLY be created when:
1. **No existing session** - First visit ever
2. **Previous session expired** - `Date.now() - session.last_active_at > sessionTimeout`

```typescript
function getOrCreateSession(): Session {
  const stored = storage.get<Session>('session');

  // Resume existing session if valid
  if (stored && !isSessionExpired(stored)) {
    stored.last_active_at = Date.now();
    return stored;
  }

  // Create new session only if none exists or expired
  return createNewSession();
}

function isSessionExpired(session: Session): boolean {
  return Date.now() - session.last_active_at > config.sessionTimeout;
}
```

### 8.1.2 Ad Click ID Tracking (adClickIds)

The SDK captures advertising click IDs from URL parameters. When found, it stores:
- `utm_id_from`: The parameter name (e.g., "gclid")
- `utm_id`: The parameter value

**Default Ad Click IDs**:
| Parameter | Platform |
|-----------|----------|
| `gclid` | Google Ads |
| `fbclid` | Facebook/Meta Ads |
| `msclkid` | Microsoft Ads |
| `dclid` | DoubleClick |
| `twclid` | Twitter/X Ads |
| `ttclid` | TikTok Ads |
| `li_fat_id` | LinkedIn Ads |
| `wbraid` | Google Ads (iOS) |
| `gbraid` | Google Ads (cross-device) |

```typescript
// Example URL: https://example.com?gclid=CjwKCAjw...
// Result in payload:
{
  utm_id_from: 'gclid',
  utm_id: 'CjwKCAjw...'
}
```

### 8.1.3 Custom Dimensions (stm_1...stm_10)

Support for 10 custom dimensions with `stm_` prefix to avoid conflicts with existing URL params.

```typescript
// API
Staminads.setDimension(1, 'premium');          // Set stm_1 = 'premium'
Staminads.setDimension(2, 'trial-user');       // Set stm_2 = 'trial-user'
Staminads.setDimensions({ 1: 'val', 2: 'val' }); // Set multiple

// In payload:
{
  stm_1: 'premium',
  stm_2: 'trial-user',
  // ...up to stm_10
}
```

**Rules:**
- Dimensions 1-10 only (throws if out of range)
- Values must be strings, max 256 chars
- Persisted with session in localStorage
- Sent with every ping/event

### 8.2 Methods

```typescript
interface StaminadsAPI {
  // Initialization
  init(config: StaminadsConfig): void;

  // Session info
  getSessionId(): string;
  getVisitorId(): string;
  getConfig(): Readonly<StaminadsConfig> | null; // Defensive copy
  getFocusDuration(): number;      // Returns milliseconds
  getTotalDuration(): number;      // Returns milliseconds

  // Manual tracking
  trackPageView(url?: string): void;
  trackEvent(name: string, properties?: Record<string, any>): void;
  trackConversion(data: ConversionData): void;

  // Custom Dimensions
  setDimension(index: number, value: string): void;  // Set single dimension (1-10)
  setDimensions(dimensions: Record<number, string>): void; // Set multiple dimensions
  getDimension(index: number): string | null;        // Get dimension value
  clearDimensions(): void;                           // Clear all dimensions

  // Control
  pause(): void;                   // Pause all tracking
  resume(): void;                  // Resume tracking
  reset(): void;                   // Clear session, start fresh

  // Debug
  debug(): SessionDebugInfo;       // Get internal state
}

interface ConversionData {
  id?: string;                     // Optional, auto-generated if not provided
  action: string;                  // e.g., 'purchase', 'signup'
  value?: number;                  // Monetary value
  currency?: string;               // e.g., 'USD'
  properties?: Record<string, any>;
}
```

---

## 9. Payload Format (Backend Compatible)

The SDK sends events to `POST /api/track` or `POST /api/track.batch`.

### 9.1 Event Payload (TrackEventDto)

```typescript
interface TrackEventPayload {
  // Required fields
  workspace_id: string;            // Workspace identifier
  session_id: string;              // Session UUID
  name: string;                    // Event name: 'screen_view', 'scroll', 'ping', 'conversion'
  path: string;                    // Current page path (e.g., '/pricing')
  landing_page: string;            // Full landing URL

  // Traffic source
  referrer?: string;               // Full referrer URL
  referrer_domain?: string;        // Referrer domain (parsed)
  referrer_path?: string;          // Referrer path (parsed)

  // UTM parameters
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;                 // Ad click ID value (e.g., gclid value)
  utm_id_from?: string;            // Ad click ID source (e.g., 'gclid', 'fbclid')

  // Device info (from ua-parser-js)
  screen_width?: number;
  screen_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device?: string;                 // 'desktop', 'mobile', 'tablet'
  browser?: string;                // 'Chrome', 'Safari', 'Firefox', etc.
  browser_type?: string;           // 'crawler', 'inapp', 'email', 'fetcher', 'cli', null
  os?: string;                     // 'macOS', 'Windows', 'iOS', 'Android', etc.
  user_agent?: string;             // Raw UA string
  connection_type?: string;        // '4g', '3g', '2g', 'slow-2g', ''

  // Locale
  language?: string;               // BCP 47: 'en-US'
  timezone?: string;               // IANA: 'America/New_York'

  // Engagement
  duration?: number;               // Focus duration in SECONDS
  max_scroll?: number;             // 0-100 percentage

  // SDK info
  sdk_version?: string;            // '5.0.0'
  sent_at?: number;                // Unix timestamp ms when payload was sent (for clock skew detection)

  // Custom Dimensions (stm_1...stm_10)
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
  properties?: Record<string, string>;  // All values must be strings
}
```

### 9.2 Event Names

| Event Name | Trigger | Key Fields |
|------------|---------|------------|
| `screen_view` | Page load, SPA navigation | path, landing_page, referrer |
| `ping` | Heartbeat (focus update) | duration, max_scroll |
| `scroll` | Scroll milestone | max_scroll |
| `conversion` | trackConversion() call | properties.action, properties.value |

### 9.3 Batch Endpoint

```typescript
// POST /api/track.batch
interface BatchPayload {
  events: TrackEventPayload[];  // All must have same workspace_id
}
```

### 9.4 Conversion via Properties

```typescript
// Conversions are tracked as events with name='conversion'
// Use properties for conversion-specific data
const conversionEvent: TrackEventPayload = {
  workspace_id: 'ws_xxx',
  session_id: 'sess_xxx',
  name: 'conversion',
  path: '/checkout/success',
  landing_page: 'https://example.com/checkout/success',
  properties: {
    action: 'purchase',
    value: '99.99',           // String, not number!
    currency: 'USD',
    order_id: 'order_123',
  },
  duration: 45,
  sdk_version: '5.0.0',
}
```

---

## 10. Build & Distribution

### 10.1 Output Formats

| Format | File | Use Case |
|--------|------|----------|
| UMD | `staminads.min.js` | Script tag, legacy |
| ESM | `staminads.esm.js` | Modern bundlers |
| CJS | `staminads.cjs.js` | Node.js, SSR |
| Types | `staminads.d.ts` | TypeScript support |

### 10.2 Size Targets

| Bundle | Target | Max |
|--------|--------|-----|
| Core (minified) | < 8 KB | 10 KB |
| Core (gzipped) | < 3 KB | 4 KB |
| Full (minified) | < 15 KB | 20 KB |
| Full (gzipped) | < 5 KB | 7 KB |

### 10.3 Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 60+ | Full support |
| Firefox | 55+ | Full support |
| Safari | 11+ | Full support |
| Edge | 79+ | Full support |
| iOS Safari | 11+ | Full support |
| Android Chrome | 60+ | Full support |
| IE 11 | N/A | Not supported |

---

## 11. Testing Requirements

### 11.1 Unit Tests

All core requirements are covered. Tests located in `src/**/*.test.ts`.

| Requirement | Status | Test File |
|-------------|--------|-----------|
| Session creation and management | ✅ | `core/session.test.ts` |
| Duration tracking precision | ✅ | `core/duration.test.ts` |
| Focus state machine transitions | ✅ | `core/duration.test.ts` |
| Storage layer fallbacks | ✅ | `storage/storage.test.ts` |
| Queue retry logic | ✅ | `transport/sender.test.ts` |
| Bot detection accuracy | ✅ | `detection/bot.test.ts` |
| UUID generation | ✅ | `utils/uuid.test.ts` |
| UTM parsing | ✅ | `utils/utm.test.ts` |
| Tiered heartbeat intervals | ✅ | `sdk.heartbeat.test.ts` |

**Additional coverage:**
- Multi-channel transmission (beacon/fetch) - `transport/sender.test.ts`
- Custom dimensions (stm_1-10) - `core/session.test.ts`
- Tab ID management - `core/session.test.ts`

**Run:** `npm test`

**Missing unit tests (future work):**
- `detection/device.ts` - DeviceDetector with Client Hints
- `events/scroll.ts` - ScrollTracker milestones
- `events/navigation.ts` - SPA navigation detection
- `utils/throttle.ts` - Rate limiting utility

### 11.2 Integration Tests

Integration tests validate multiple modules working together. Located in `tests/integration/`.

| Scenario | Status | Test File |
|----------|--------|-----------|
| Multi-tab scenarios | ✅ | `multi-tab.integration.test.ts` |
| Offline/online transitions | ✅ | `offline.integration.test.ts` |
| SPA navigation | ✅ | `spa-navigation.integration.test.ts` |
| Page lifecycle events | ✅ | `lifecycle.integration.test.ts` |
| Storage quota handling | ✅ | `storage-quota.integration.test.ts` |

**Test approach:**
- Mock browser APIs (Page Visibility, History, Storage)
- Use Vitest fake timers for time-sensitive tests
- Validate data integrity across module boundaries

**Run:** `npm test -- tests/integration/`

### 11.3 E2E Tests (Playwright)

| Scenario | Tests | Status |
|----------|-------|--------|
| Full session lifecycle | 10 | ✅ |
| Tab switching duration accuracy | 7 | ✅ |
| Browser close data persistence | 10 | ⚠️ (7/10 pass) |
| Mobile behavior | 10 | ⚠️ (9/10 pass) |
| Slow network handling | 11 | ✅ |

**Total: 56 tests (49 passing, 87.5%)**

**Run:** `npm run test:e2e`

**Test Files:**
```
tests/e2e/
├── fixtures.ts           # Custom Playwright fixtures with stealth mode
├── fixtures/
│   ├── test-page.html    # Basic test page with SDK
│   └── spa-page.html     # SPA test page for navigation
├── helpers/
│   └── mock-server.ts    # Express mock API server
├── session-lifecycle.spec.ts  # Session creation, resume, events
├── duration-accuracy.spec.ts  # Focus/blur timing
├── data-persistence.spec.ts   # localStorage/sessionStorage
├── mobile-behavior.spec.ts    # Desktop behavior
├── mobile-emulation.spec.ts   # Mobile device emulation
└── network-handling.spec.ts   # Beacon, fetch, queue, offline
```

---

## 12. Security Considerations

1. **No PII Collection**: SDK must not collect personal data
2. **Secure Transport**: HTTPS only
3. **CSP Compatible**: No inline scripts, no eval
4. **XSS Safe**: No DOM manipulation with user data
5. **No Cookies**: Use localStorage only
6. **Workspace Validation**: Server-side origin check

---

## 13. Performance Budgets

| Metric | Target |
|--------|--------|
| Parse time | < 10ms |
| Init time | < 20ms |
| Memory footprint | < 500KB |
| CPU (idle) | < 0.1% |
| CPU (active) | < 1% |
| Network (hourly) | < 10KB |

---

## 14. Critical Edge Cases (Gemini Review)

### 14.1 Multi-Tab Strategy (KISS Principle)

**Approach**: No client-side coordination. Use tab identification for server-side deduplication.

Major analytics SDKs (Google Analytics, Mixpanel, Amplitude) **do not use BroadcastChannel** or any multi-tab coordination. They accept rare race conditions and handle deduplication server-side.

```typescript
// Generate unique tab ID (per browser tab, not per session)
const getTabId = (): string => {
  let tabId = sessionStorage.getItem('stm_tab_id');
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem('stm_tab_id', tabId);
  }
  return tabId;
};

// Include tab_id in every event for server-side deduplication
const event = {
  session_id: getSessionId(),
  tab_id: getTabId(),
  timestamp: Date.now(),
  // ... other fields
};
```

**Why No BroadcastChannel?**
- Major SDKs don't use it (proven at scale)
- Race conditions are rare (<0.01% of events)
- Server-side deduplication is more reliable
- Simpler code = fewer bugs
- BroadcastChannel adds ~2KB and complexity

**Server-Side Deduplication**:
```sql
-- ClickHouse: Deduplicate by session + tab + time window
SELECT DISTINCT ON (session_id, tab_id, toStartOfSecond(timestamp))
  *
FROM events
ORDER BY timestamp DESC
```

### 14.2 Safari Private Mode (Critical)

**Problem**: localStorage throws `QuotaExceededError` in Safari Private Mode even on empty storage.

**Impact**: SDK crashes on page load for ~15% of iOS users.

```typescript
class Storage {
  private useMemory = false;
  private memory = new Map<string, any>();

  constructor() {
    // Test localStorage on init
    try {
      localStorage.setItem('stm_test', 'test');
      localStorage.removeItem('stm_test');
    } catch {
      this.useMemory = true;
    }
  }

  set<T>(key: string, value: T): void {
    if (this.useMemory) {
      this.memory.set(key, value);
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded mid-session
      this.useMemory = true;
      this.memory.set(key, value);
    }
  }
}
```

### 14.3 Beacon API Size Limits

**Problem**: Beacon limit is 64KB on Chrome but **16KB on Safari**.

```typescript
const MAX_BEACON_SIZE = 15 * 1024; // 15KB for Safari safety

const flushQueue = (events: Event[]): void => {
  const data = JSON.stringify(events);

  if (data.length > MAX_BEACON_SIZE) {
    // Chunk into smaller batches
    const batches = chunkBySize(events, MAX_BEACON_SIZE);
    for (const batch of batches) {
      navigator.sendBeacon(url, JSON.stringify(batch));
    }
  } else {
    navigator.sendBeacon(url, data);
  }
};
```

### 14.4 Bfcache (Back-Forward Cache)

**Problem**: Chrome/Safari cache entire pages. Back navigation can cause duplicate sessions.

```typescript
// Detect page restored from bfcache
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    // Page was restored from bfcache
    // Resume existing session instead of creating new one
    this.resumeSession();
  }
});

// Ensure data is sent before page is cached
window.addEventListener('pagehide', (event) => {
  this.flushData();
});
```

### 14.4 Deduplication on Unload

**Problem**: Both `beforeunload` and `pagehide` can fire.

```typescript
let flushed = false;
const flushOnce = () => {
  if (flushed) return;
  flushed = true;
  sendData();
};

window.addEventListener('pagehide', flushOnce);
window.addEventListener('beforeunload', flushOnce);
```

### 14.5 Negative Time Jumps

**Problem**: `performance.now()` can jump backwards after system suspend.

```typescript
let lastTimestamp = performance.now();

const getDuration = (): number => {
  const now = performance.now();
  const delta = now - lastTimestamp;

  // Detect backwards jump OR unrealistic forward jump
  if (delta < 0 || delta > 5000) {
    lastTimestamp = now;
    return 0; // Discard this interval
  }

  lastTimestamp = now;
  return delta;
};
```

### 14.6 User Agent Parsing Strategy

**Problem**: ua-parser-js is ~24KB gzipped - impossible to hit <5KB target.

**Solution**: Server-side parsing OR navigator.userAgentData

```typescript
// Option A: Send raw UA to server (RECOMMENDED)
const deviceInfo = {
  user_agent: navigator.userAgent,
  // Let backend parse with ua-parser-js
};

// Option B: Use modern navigator.userAgentData (Chrome 90+)
if (navigator.userAgentData) {
  const data = await navigator.userAgentData.getHighEntropyValues([
    'platform', 'platformVersion', 'model', 'mobile'
  ]);
  // Native parsing, no library needed
}

// Option C: Minimal client detection (~500 bytes)
const getDevice = (): string => {
  const ua = navigator.userAgent;
  if (/Mobile|Android|iPhone/i.test(ua)) return 'mobile';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  return 'desktop';
};
```

### 14.7 Service Worker Background Sync

**SOTA 2025**: Use Service Worker for retry after tab close.

```typescript
// service-worker.ts
self.addEventListener('sync', (event) => {
  if (event.tag === 'staminads-sync') {
    event.waitUntil(flushQueuedEvents());
  }
});

// main.ts - Register sync when flush fails
if ('serviceWorker' in navigator && 'SyncManager' in window) {
  const registration = await navigator.serviceWorker.ready;
  await registration.sync.register('staminads-sync');
}
```

### 14.8 Page Lifecycle API (Mobile)

**Critical for iOS/Android**: Tab freezes silently after 30s-5min background.

```typescript
// Page Lifecycle API events
document.addEventListener('freeze', () => {
  // Tab is being frozen - LAST CHANCE to send data
  pauseFocusTracking();
  flushImmediately(); // Must be sync/beacon
});

document.addEventListener('resume', () => {
  resumeFocusTracking();
});
```

---

## 15. Size Targets

| Component | Size (gzipped) |
|-----------|----------------|
| Core SDK logic | ~3KB |
| ua-parser-js | ~24KB |
| **Total** | **~27KB** |

**Bundle Strategy**: Single bundle with ua-parser-js included for Client Hints support.

The size is acceptable because:
- Client Hints provide accurate OS version detection (Win10 vs 11, macOS versions)
- ua-parser-js is loaded once and cached
- Analytics scripts are non-blocking (async/defer)
- Comparable to other analytics SDKs (GA4: ~45KB, Mixpanel: ~35KB)

---

## Changelog from v4.0.0

| Feature | v4.0.0 | v5.0 |
|---------|--------|------|
| Language | JavaScript | TypeScript |
| Storage | localStorage only | localStorage + memory fallback |
| Duration precision | Seconds | Milliseconds |
| Offline support | Basic | localStorage queue with retry |
| SPA support | None | Full (History API hooks) |
| Focus tracking | Basic | State machine with edge cases |
| Multi-tab | Race conditions | tab_id for server-side dedup |
| Bundle formats | UMD only | UMD + ESM + CJS |
| Testing | None | Full suite |
| UA Parsing | Basic regex | ua-parser-js + Client Hints |
| OS Detection | Frozen UA | Actual versions via Client Hints |
| Heartbeat | Flat 7s/10s, 7min max | Tiered intervals, 10min max, active time only |
