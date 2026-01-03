# Staminads Web SDK v5.0

Ultra-reliable web analytics SDK for tracking **TimeScore** metrics with millisecond precision.

## Mission Critical

- **Zero Data Loss**: Every session MUST be captured and transmitted
- **Exact Duration**: Focus time measured with millisecond precision, counting only truly active engagement

## Features

- **Focus State Machine**: FOCUSED → BLURRED → HIDDEN states with precise transitions
- **Multi-Channel Transmission**: Beacon → Fetch → Offline Queue (never lose data)
- **localStorage + Memory Fallback**: Simple, reliable storage (Safari Private Mode safe)
- **SPA Support**: Auto-detects pushState, replaceState, popstate, hashchange
- **Client Hints**: Accurate OS detection (Win10 vs 11, macOS versions) via ua-parser-js
- **Bot Detection**: User-agent patterns + webdriver + fingerprinting
- **Custom Dimensions**: stm_1...stm_10 for custom tracking
- **Ad Click ID Tracking**: gclid, fbclid, msclkid, and more

## Installation

### Via script tag (Recommended)

The SDK auto-initializes from `window.StaminadsConfig`. No explicit `init()` call required.

```html
<script>
window.StaminadsConfig = {
  workspace_id: 'ws_your_workspace_id',
  endpoint: 'https://your-api.com',
  debug: false // optional
};
</script>
<script async src="path/to/staminads.min.js"></script>
```

### Via npm

```bash
npm install @staminads/sdk
```

```typescript
// Set config before importing (or in a separate script tag)
window.StaminadsConfig = {
  workspace_id: 'ws_your_workspace_id',
  endpoint: 'https://your-api.com',
  sessionTimeout: 30 * 60 * 1000, // optional - 30 min default
  debug: false, // optional
  adClickIds: ['gclid', 'fbclid'] // optional - custom ad click IDs
};

import Staminads from '@staminads/sdk';

// SDK is auto-initialized, ready to use
await Staminads.trackEvent('my_event');
```

## API

All methods (except `getConfig()` and `debug()`) are async and return Promises.

```typescript
// Session info (async)
await Staminads.getSessionId();       // Current session UUID
await Staminads.getVisitorId();       // Persistent visitor UUID
await Staminads.getFocusDuration();   // Active time in milliseconds
await Staminads.getTotalDuration();   // Wall clock time in milliseconds

// Synchronous methods
Staminads.getConfig();                // Returns config or null
Staminads.debug();                    // Get debug info

// Manual tracking (async)
await Staminads.trackPageView(url?);  // Track SPA navigation
await Staminads.trackEvent(name, properties?);
await Staminads.trackConversion({ action, value?, currency?, properties? });

// Custom Dimensions (async)
await Staminads.setDimension(1, 'premium');    // Set stm_1 = 'premium'
await Staminads.setDimensions({ 1: 'a', 2: 'b' }); // Set multiple
await Staminads.getDimension(1);               // Get dimension value
await Staminads.clearDimensions();             // Clear all

// Control (async)
await Staminads.pause();              // Pause tracking
await Staminads.resume();             // Resume tracking
await Staminads.reset();              // Clear session, start fresh
```

## Configuration

Set `window.StaminadsConfig` before loading the SDK script:

```typescript
interface StaminadsConfig {
  // Required
  workspace_id: string // Workspace identifier
  endpoint: string // API endpoint (required - no default)

  // Optional
  debug?: boolean // Default: false
  sessionTimeout?: number // Default: 30 * 60 * 1000 (30 min)
  adClickIds?: string[] // Default: ['gclid', 'fbclid', 'msclkid', ...]
  trackSPA?: boolean // Default: true
  trackScroll?: boolean // Default: true
}

// TypeScript global declaration
declare global {
  interface Window {
    StaminadsConfig?: StaminadsConfig;
  }
}
```

## Events Tracked

| Event         | Trigger                                 | Data                      |
| ------------- | --------------------------------------- | ------------------------- |
| `screen_view` | Page load, SPA navigation               | path, referrer, UTM       |
| `ping`        | Heartbeat (10s desktop, 7s mobile)      | duration, max_scroll      |
| `scroll`      | Scroll milestones (25%, 50%, 75%, 100%) | max_scroll                |
| `conversion`  | trackConversion() call                  | action, value, properties |

## Ad Click ID Tracking

The SDK automatically captures advertising click IDs from URLs:

| Parameter   | Platform                  |
| ----------- | ------------------------- |
| `gclid`     | Google Ads                |
| `fbclid`    | Facebook/Meta Ads         |
| `msclkid`   | Microsoft Ads             |
| `dclid`     | DoubleClick               |
| `twclid`    | Twitter/X Ads             |
| `ttclid`    | TikTok Ads                |
| `li_fat_id` | LinkedIn Ads              |
| `wbraid`    | Google Ads (iOS)          |
| `gbraid`    | Google Ads (cross-device) |

When found, the SDK sends:

- `utm_id_from`: The parameter name (e.g., "gclid")
- `utm_id`: The parameter value

## Browser Support

| Browser        | Version |
| -------------- | ------- |
| Chrome         | 60+     |
| Firefox        | 55+     |
| Safari         | 11+     |
| Edge           | 79+     |
| iOS Safari     | 11+     |
| Android Chrome | 60+     |

## Bundle Size

| Bundle         | Size      |
| -------------- | --------- |
| UMD (minified) | ~48KB     |
| UMD (gzipped)  | **~18KB** |

Includes ua-parser-js for accurate device/OS detection with Client Hints support.

## Documentation

See [SPECS.md](./SPECS.md) for detailed technical specifications.
