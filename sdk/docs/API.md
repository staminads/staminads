# Staminads SDK v3.0.0 - API Reference

Ultra-reliable web analytics SDK for tracking **TimeScore** metrics with millisecond precision.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Methods](#methods)
  - [Session Information](#session-information)
  - [Tracking](#tracking)
  - [Custom Dimensions](#custom-dimensions)
  - [Control](#control)
  - [Configuration & Debug](#configuration--debug)
- [TypeScript Types](#typescript-types)
- [Automatic Tracking](#automatic-tracking)
- [Browser Support](#browser-support)

---

## Installation

### Script Tag (Recommended)

The SDK auto-initializes from `window.StaminadsConfig`. No explicit `init()` call required.

```html
<script>
window.StaminadsConfig = {
  workspace_id: 'ws_your_workspace_id',
  endpoint: 'https://your-api.com'
};
</script>
<script async src="staminads.min.js"></script>
```

### NPM

```bash
npm install @staminads/sdk
```

```typescript
// Set config before importing (or in a separate script tag)
window.StaminadsConfig = {
  workspace_id: 'ws_your_workspace_id',
  endpoint: 'https://your-api.com'
};

import Staminads from '@staminads/sdk';

// SDK is auto-initialized, ready to use
await Staminads.trackGoal({ action: 'signup' });
```

### Bundle Sizes

| Format | Size |
|--------|------|
| UMD (minified) | ~48KB |
| UMD (gzipped) | ~18KB |
| ESM | ~71KB |
| CJS | ~71KB |

---

## Configuration

### `StaminadsConfig`

Set `window.StaminadsConfig` before loading the SDK script.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `workspace_id` | `string` | **Yes** | - | Workspace identifier |
| `endpoint` | `string` | **Yes** | - | API endpoint URL |
| `debug` | `boolean` | No | `false` | Enable debug logging to console |
| `sessionTimeout` | `number` | No | `1800000` (30 min) | Session timeout in milliseconds |
| `heartbeatInterval` | `number` | No | `10000` (10s) | Legacy fallback interval in ms |
| `adClickIds` | `string[]` | No | [See below](#default-ad-click-ids) | Ad click IDs to track |
| `trackSPA` | `boolean` | No | `true` | Auto-detect SPA navigation |
| `trackScroll` | `boolean` | No | `true` | Track scroll depth milestones |
| `trackClicks` | `boolean` | No | `false` | Reserved for future use |
| `heartbeatTiers` | `HeartbeatTier[]` | No | [See below](#default-heartbeat-tiers) | Tiered heartbeat intervals |
| `heartbeatMaxDuration` | `number` | No | `600000` (10 min) | Max tracking duration per page |
| `resetHeartbeatOnNavigation` | `boolean` | No | `false` | Reset duration timer on SPA navigation |

### Default Heartbeat Tiers

Heartbeat frequency decreases over time to reduce server load while maintaining accuracy:

```typescript
[
  // 0-3 min: High frequency (initial engagement is critical)
  { after: 0, desktopInterval: 10000, mobileInterval: 7000 },

  // 3-5 min: Medium frequency (user is engaged, reduce load)
  { after: 180000, desktopInterval: 20000, mobileInterval: 14000 },

  // 5-10 min: Low frequency (long-form content, minimal pings)
  { after: 300000, desktopInterval: 30000, mobileInterval: 21000 }
]
```

### Default Ad Click IDs

The SDK automatically captures these advertising click IDs from URLs:

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

When found, the SDK sends:
- `utm_id`: The parameter value
- `utm_id_from`: The parameter name (e.g., `"gclid"`)

---

## Methods

All methods (except `getConfig()` and `debug()`) are **async** and return Promises.

### Session Information

#### `getSessionId(): Promise<string>`

Returns the current session UUID.

```typescript
const sessionId = await Staminads.getSessionId();
// "550e8400-e29b-41d4-a716-446655440000"
```

#### `getFocusDuration(): Promise<number>`

Returns active/focused time in milliseconds. Only counts time when the page is visible and focused.

```typescript
const focusMs = await Staminads.getFocusDuration();
console.log(`User was active for ${focusMs / 1000} seconds`);
```

#### `getTotalDuration(): Promise<number>`

Returns wall clock time since session start in milliseconds.

```typescript
const totalMs = await Staminads.getTotalDuration();
console.log(`Session duration: ${totalMs / 1000} seconds`);
```

---

### Tracking

#### `trackPageView(url?: string): Promise<void>`

Manually track a page view. Use for SPA navigation if `trackSPA` is disabled, or to force a pageview event.

```typescript
// Track current URL
await Staminads.trackPageView();

// Track specific URL/path
await Staminads.trackPageView('/dashboard');
await Staminads.trackPageView('/products/123');
```

#### `trackGoal(data: GoalData): Promise<void>`

Track a conversion or goal event.

```typescript
// Simple goal
await Staminads.trackGoal({
  action: 'signup'
});

// Goal with value
await Staminads.trackGoal({
  action: 'purchase',
  value: 99.99,
  currency: 'USD'
});

// Goal with custom properties
await Staminads.trackGoal({
  action: 'add_to_cart',
  value: 49.99,
  properties: {
    product_id: 'SKU123',
    category: 'electronics',
    variant: 'blue'
  }
});
```

**GoalData Interface:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `action` | `string` | **Yes** | Goal/event name |
| `id` | `string` | No | Optional goal identifier |
| `value` | `number` | No | Revenue or conversion value |
| `currency` | `string` | No | Currency code (USD, EUR, etc.) |
| `properties` | `Record<string, string>` | No | Custom key-value properties |

---

### Custom Dimensions

Custom dimensions allow you to segment analytics data with your own attributes. Supports indices **1-10** with max **256 characters** per value.

#### URL Parameters (Automatic)

Custom dimensions can be set via URL parameters `stm_1` through `stm_10`. They are automatically captured when the SDK initializes.

```
https://example.com/page?stm_1=campaign_a&stm_2=variant_b&stm_3=source_x
```

**Priority rule**: Existing dimension values take priority over URL parameters. If a dimension is already set (e.g., from a previous page in the session), the URL parameter will NOT overwrite it.

This is useful for:
- Campaign tracking links
- A/B test variant assignment
- Affiliate tracking
- Any scenario where you want to pass dimension values via URL

#### `setDimension(index: number, value: string): Promise<void>`

Set a single custom dimension programmatically.

```typescript
await Staminads.setDimension(1, 'premium-user');
await Staminads.setDimension(2, 'us-west');
await Staminads.setDimension(3, 'experiment-variant-b');
```

#### `setDimensions(dimensions: Record<number, string>): Promise<void>`

Set multiple dimensions at once.

```typescript
await Staminads.setDimensions({
  1: 'premium-user',
  2: 'us-west',
  3: 'experiment-variant-b'
});
```

#### `getDimension(index: number): Promise<string | null>`

Get a dimension value. Returns `null` if not set.

```typescript
const tier = await Staminads.getDimension(1);
// "premium-user" or null
```

#### `clearDimensions(): Promise<void>`

Clear all custom dimensions.

```typescript
await Staminads.clearDimensions();
```

---

### Control

#### `pause(): Promise<void>`

Pause tracking and heartbeat. Use when user opts out or during sensitive operations.

```typescript
// User opts out of tracking
await Staminads.pause();
```

#### `resume(): Promise<void>`

Resume tracking after pause. This also resets the max duration timer.

```typescript
// User opts back in
await Staminads.resume();
```

#### `reset(): Promise<void>`

Create a new session and clear all state. Use after logout or major context change.

```typescript
// After user logout
await Staminads.reset();
```

---

### Configuration & Debug

#### `getConfig(): Readonly<StaminadsConfig> | null`

Returns the current configuration. **Synchronous**. Returns `null` if not initialized.

```typescript
const config = Staminads.getConfig();
if (config) {
  console.log('Workspace:', config.workspace_id);
  console.log('Endpoint:', config.endpoint);
}
```

#### `debug(): SessionDebugInfo`

Returns debug information about the current session state. **Synchronous**.

```typescript
const info = Staminads.debug();
console.log(info);
// {
//   session: { id: '...', focus_duration_ms: 12345, ... },
//   config: { workspace_id: '...', endpoint: '...', ... },
//   isTracking: true,
//   actionsCount: 5,
//   checkpoint: 3,
//   currentPage: '/dashboard'
// }
```

#### `init(config: StaminadsConfig): Promise<void>`

Manually initialize the SDK. Usually not needed if using `window.StaminadsConfig`.

```typescript
await Staminads.init({
  workspace_id: 'ws_abc123',
  endpoint: 'https://api.example.com',
  debug: true
});
```

---

## TypeScript Types

### `StaminadsConfig`

```typescript
interface StaminadsConfig {
  // Required
  workspace_id: string;
  endpoint: string;

  // Optional
  debug?: boolean;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  adClickIds?: string[];
  trackSPA?: boolean;
  trackScroll?: boolean;
  trackClicks?: boolean;
  heartbeatTiers?: HeartbeatTier[];
  heartbeatMaxDuration?: number;
  resetHeartbeatOnNavigation?: boolean;
}
```

### `HeartbeatTier`

```typescript
interface HeartbeatTier {
  /** Duration threshold in ms. Tier applies when activeTime >= after. */
  after: number;
  /** Interval in ms for desktop devices. null = stop heartbeat. */
  desktopInterval: number | null;
  /** Interval in ms for mobile devices. null = stop heartbeat. */
  mobileInterval: number | null;
}
```

### `GoalData`

```typescript
interface GoalData {
  action: string;                      // Required: goal name
  id?: string;                         // Optional: goal identifier
  value?: number;                      // Optional: monetary value
  currency?: string;                   // Optional: currency code
  properties?: Record<string, string>; // Optional: custom properties
}
```

### `SessionDebugInfo`

```typescript
interface SessionDebugInfo {
  session: Session | null;
  config: InternalConfig | null;
  isTracking: boolean;
  actionsCount: number;
  checkpoint: number;
  currentPage: string | null;
}
```

### `Session`

```typescript
interface Session {
  id: string;
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
```

### `UTMParams`

```typescript
interface UTMParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  id: string | null;       // Ad click ID value
  id_from: string | null;  // Ad click ID source (e.g., 'gclid')
}
```

### `DeviceInfo`

```typescript
interface DeviceInfo {
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
```

### `CustomDimensions`

```typescript
interface CustomDimensions {
  [key: number]: string;  // e.g., { 1: 'premium', 2: 'us-west' }
}
```

### Global Window Declaration

```typescript
declare global {
  interface Window {
    StaminadsConfig?: StaminadsConfig;
  }
}
```

---

## Automatic Tracking

The SDK automatically tracks these events without any code:

| Event | Trigger | Data Captured |
|-------|---------|---------------|
| `screen_view` | Page load, SPA navigation | path, referrer, UTM params |
| `ping` | Heartbeat (tiered intervals) | focus duration, max scroll |
| `scroll` | Scroll milestones (25%, 50%, 75%, 100%) | max scroll percentage |

### SPA Detection

When `trackSPA: true` (default), the SDK automatically detects navigation in single-page applications by patching:

- `History.pushState()`
- `History.replaceState()`
- `popstate` event
- `hashchange` event

### Bot Detection

The SDK automatically detects and excludes bots using:

1. User-agent pattern matching (40+ bot patterns)
2. WebDriver detection (`navigator.webdriver`)
3. Feature fingerprinting (plugins, languages, screen dimensions)

---

## Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 60+ |
| Firefox | 55+ |
| Safari | 11+ |
| Edge | 79+ |
| iOS Safari | 11+ |
| Android Chrome | 60+ |

---

## Storage

The SDK uses localStorage with prefix `stm_`:

| Key | Purpose |
|-----|---------|
| `stm_session` | Current session data |
| `stm_dimensions` | Custom dimensions |
| `stm_pending` | Offline payload queue |

SessionStorage is used for tab-specific data:
| Key | Purpose |
|-----|---------|
| `stm_session_state` | Current session state |

---

## Offline Support

The SDK includes built-in offline resilience:

1. **Multi-channel transmission**: Beacon API (preferred) → Fetch API → Offline Queue
2. **Automatic retry**: Failed payloads are queued in localStorage
3. **Queue limits**: Max 100 items, 24-hour TTL
4. **Auto-flush**: Queue is processed when connection is restored

---

## Examples

### Basic Setup

```html
<script>
window.StaminadsConfig = {
  workspace_id: 'ws_abc123',
  endpoint: 'https://analytics.example.com'
};
</script>
<script async src="staminads.min.js"></script>
```

### Track E-commerce Purchase

```typescript
await Staminads.trackGoal({
  action: 'purchase',
  value: 149.99,
  currency: 'USD',
  properties: {
    order_id: 'ORD-12345',
    items: '3',
    coupon: 'SAVE10'
  }
});
```

### Segment Users with Custom Dimensions

```typescript
// After user authentication
await Staminads.setDimensions({
  1: user.subscription_tier,  // 'free', 'pro', 'enterprise'
  2: user.region,             // 'us', 'eu', 'apac'
  3: user.account_age         // 'new', 'returning', 'veteran'
});
```

### Track Campaign Attribution via URL

Pass custom dimensions through URL parameters for campaign tracking:

```
https://example.com/landing?stm_1=summer_sale&stm_2=email&stm_3=variant_a
```

The SDK automatically captures `stm_1` through `stm_10` on initialization.
Combine with UTM parameters for full attribution:

```
https://example.com/landing?utm_source=newsletter&utm_campaign=summer&stm_1=segment_a&stm_2=cohort_2024
```

### Handle User Consent

```typescript
// User declines tracking
document.getElementById('decline-btn').onclick = async () => {
  await Staminads.pause();
};

// User accepts tracking
document.getElementById('accept-btn').onclick = async () => {
  await Staminads.resume();
};
```

### Debug in Development

```typescript
window.StaminadsConfig = {
  workspace_id: 'ws_abc123',
  endpoint: 'https://analytics.example.com',
  debug: true  // Enables console logging
};

// Later, inspect current state
console.log(Staminads.debug());
```
