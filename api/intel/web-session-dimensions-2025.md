# Web Session Dimensions Report 2025

> Investigation of all dimensions reliably available from web sessions using ua-parser-js and browser JavaScript APIs.

## Executive Summary

Due to Chrome's User-Agent Reduction (completed in Chrome 116, Sept 2023), several traditionally tracked dimensions are now **frozen or unavailable**. This report identifies which dimensions remain reliable, explains their value for **analyzing time spent engagement**, and maps each to **ad platform targeting options** in Google Ads and Facebook Ads.

**Staminads Goal:** Help marketers identify which traffic sources, devices, and user segments drive the highest engagement (time spent on site), then **take action** by adjusting ad targeting to acquire more high-engagement users.

**Key Actionable Dimensions:**
- **Device type** → Both platforms support bid adjustments by device
- **Day/Hour** → Both platforms support dayparting/ad scheduling
- **OS** → Both platforms support iOS/Android targeting
- **Language** → Facebook (Google deprecating for Search in 2025)
- **Connection type** → Both support Wi-Fi targeting

---

## 1. UA-Parser-JS Dimensions

### Source: User-Agent String Parsing

ua-parser-js v2.x parses the `User-Agent` header/string into structured data.

| Category | Field | Reliable? | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|----------|-------|-----------|-------|-------------------------------|----------------------|
| **Browser** | `name` | ✅ Yes | ✅ | Different browsers correlate with different engagement patterns—Safari users on Apple devices often show higher time spent than Chrome users on budget Android devices. | ⚠️ Google (DV360/Ad Manager only), ❌ Facebook |
| | `major` | ✅ Yes | ❌ | Users on outdated browser versions may experience performance issues leading to shorter sessions and higher bounce rates. | ❌ Neither platform |
| | `version` | ⚠️ Partial | ❌ | Full version frozen to `X.0.0.0` in Chrome 101+ | ❌ Neither platform |
| | `type` | ✅ Yes | ✅ | Identifies bots and crawlers that should be excluded from engagement metrics, plus in-app browsers (Facebook, Instagram) which typically show lower time spent due to quick browsing behavior. | ❌ Neither platform |
| **OS** | `name` | ✅ Yes | ✅ | OS reveals user ecosystem loyalty—macOS/iOS users often show premium engagement patterns, while specific Linux distros may indicate developer audiences with different content consumption habits. | ✅ Google (Android/iOS/Windows/macOS), ✅ Facebook (iOS/Android with versions) |
| | `version` | ❌ No | ❌ | Frozen: Android→"10", Windows→"10", macOS may still work | ✅ Facebook (iOS 14+, Android ranges) |
| **Device** | `type` | ✅ Yes | ✅ | **Critical dimension**—tablets consistently show 50-100% higher time spent than mobile due to lean-back browsing; desktop users engage longer than mobile due to fewer distractions. | ✅ Google (Computer/Mobile/Tablet/TV), ✅ Facebook (Desktop/Mobile/Tablet) |
| | `vendor` | ❌ No | ❌ | Cannot reliably detect without Client Hints | ✅ Facebook (Apple/Samsung device targeting) |
| | `model` | ❌ No | ❌ | Frozen to "K" on Android since Chrome 110 | ⚠️ Facebook (limited specific models) |
| **Engine** | `name` | ✅ Yes | ❌ | Engine differences (Blink vs WebKit vs Gecko) can reveal rendering performance issues that impact user experience and session duration. | ❌ Neither platform |
| | `version` | ⚠️ Partial | ❌ | May be frozen in some browsers | ❌ Neither platform |
| **CPU** | `architecture` | ❌ No | ❌ | Removed from UA string in Chrome | ❌ Neither platform |

### Device Type Values (Complete List)
```
mobile      - Smartphones: baseline engagement, often distracted users
tablet      - Tablets: 50-100% higher time spent, lean-back browsing mode
console     - Gaming consoles: niche audience, often watching video content
smarttv     - Smart TVs: passive viewing, very long sessions for video
wearable    - Smartwatches: micro-sessions, quick information lookups
xr          - VR/AR headsets: immersive sessions, emerging high-engagement segment
embedded    - Kiosks, car systems: controlled environments, task-focused
(undefined) - Desktop: focused work sessions, higher engagement than mobile
```

### Browser Type Values (Complete List)
```
crawler      - Search engine bots: EXCLUDE from all engagement metrics
inapp        - In-app browsers: typically 40-60% lower time spent, users quickly return to app
email        - Email clients: preview-only, should be excluded or segmented
fetcher      - Link preview bots: EXCLUDE, not real users
cli          - Command-line browsers: developer tools, exclude
mediaplayer  - Media apps: may inflate video engagement metrics
module       - HTTP libraries: EXCLUDE, automated requests
(undefined)  - Standard web browsers: primary audience for analysis
```

---

## 2. Browser JavaScript APIs

### Always Reliable (97-100% Browser Support)

| Dimension | API | Support | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|-----|---------|-------|-------------------------------|----------------------|
| `screen_width` | `screen.width` | 100% | ✅ | Screen size correlates with device quality and user context—larger screens enable comfortable reading leading to longer sessions; helps identify premium device users. | ❌ Neither (use device type instead) |
| `screen_height` | `screen.height` | 100% | ✅ | Combined with width, reveals device form factor and aspect ratio which influences content consumption patterns and scroll behavior. | ❌ Neither (use device type instead) |
| `viewport_width` | `window.innerWidth` | 100% | ✅ | Actual visible area affects content layout breakpoints—users hitting awkward responsive breakpoints may bounce faster due to poor UX. | ❌ Neither platform |
| `viewport_height` | `window.innerHeight` | 100% | ✅ | Above-the-fold content visibility directly impacts initial engagement; smaller viewports require more scrolling which affects time spent distribution. | ❌ Neither platform |
| `device_pixel_ratio` | `window.devicePixelRatio` | 97% | ❌ | Retina displays (2x, 3x) indicate premium devices whose owners typically show 20-40% higher engagement due to better visual experience and higher purchasing intent. | ❌ Neither platform |
| `language` | `navigator.language` | 100% | ✅ | **Critical for content localization ROI**—reveals if users are viewing content in their native language; mismatched language/content causes immediate bounces. | ⚠️ Google (deprecated, AI-automated by end 2025), ✅ Facebook |
| `timezone` | `Intl...timeZone` | 100% | ✅ | Enables time-of-day analysis in user's local time—reveals optimal publishing/ad scheduling times when your audience is most engaged. | ✅ Google (location-based), ✅ Facebook (location-based) |
| `cookies_enabled` | `navigator.cookieEnabled` | 100% | ❌ | Users with cookies disabled may have tracking issues affecting session stitching accuracy; also indicates privacy-conscious segment. | ❌ Neither platform |
| `color_depth` | `screen.colorDepth` | 100% | ❌ | Low color depth (< 24 bit) may indicate older devices or accessibility tools, which can affect visual content engagement. | ❌ Neither platform |
| `online` | `navigator.onLine` | 100% | ❌ | Offline-capable PWA usage patterns; helps identify users in poor connectivity areas who may have interrupted sessions. | ❌ Neither platform |

### Good Support (80-95%)

| Dimension | API | Support | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|-----|---------|-------|-------------------------------|----------------------|
| `touch_support` | `'ontouchstart' in window` | 95% | ❌ | Touch vs mouse input fundamentally changes interaction patterns—touch users scroll faster but may engage less deeply with interactive elements. | ❌ Neither (use device type) |
| `max_touch_points` | `navigator.maxTouchPoints` | 90% | ❌ | Multi-touch capability indicates modern devices; helps distinguish touch laptops from tablets for more accurate device segmentation. | ❌ Neither platform |
| `orientation` | `screen.orientation.type` | 85% | ❌ | Portrait vs landscape viewing affects content consumption—landscape often indicates intentional video watching with higher completion rates. | ❌ Neither platform |
| `pdf_viewer` | `navigator.pdfViewerEnabled` | 80% | ❌ | Relevant for sites with downloadable content; built-in PDF viewing keeps users on-site longer vs downloading and leaving. | ❌ Neither platform |

### Limited Support (Chromium-only)

| Dimension | API | Support | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|-----|---------|-------|-------------------------------|----------------------|
| `connection_type` | `navigator.connection.effectiveType` | 70% | ✅ | **High-value dimension**—users on slow connections (2g/3g) bounce 50%+ more often; helps identify if poor engagement is due to content or connectivity. | ✅ Google (Wi-Fi vs carrier), ✅ Facebook (Wi-Fi only option) |
| `connection_downlink` | `navigator.connection.downlink` | 70% | ❌ | Bandwidth estimate helps explain video abandonment and image-heavy page bounces; enables connection-aware content optimization. | ❌ Neither platform |
| `connection_rtt` | `navigator.connection.rtt` | 70% | ❌ | Latency directly impacts perceived performance; high RTT users may abandon before content loads, skewing engagement metrics. | ❌ Neither platform |

⚠️ **Note:** Connection APIs return `null` on Safari and Firefox—approximately 30% of users. Segment these separately.

---

## 3. Traffic Source Dimensions

### From URL & Referrer (Always Reliable)

| Dimension | Source | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|--------|-------|-------------------------------|----------------------|
| `referrer` | `document.referrer` | ✅ | **Core dimension for traffic quality analysis**—reveals which external sources send engaged users vs bounce-prone visitors. | N/A (tracking, not targeting) |
| `referrer_domain` | Parsed from referrer | ✅ | Aggregates referrer data to compare engagement across traffic sources—e.g., "Does reddit.com send more engaged users than twitter.com?" | N/A (tracking, not targeting) |
| `referrer_path` | Parsed from referrer | ✅ | Identifies specific external pages/posts driving traffic—a viral article may send different quality traffic than a homepage link. | N/A (tracking, not targeting) |
| `landing_page` | `location.href` | ✅ | **Critical for content performance**—reveals which pages successfully capture attention vs which have high bounce rates regardless of traffic source. | N/A (tracking, not targeting) |
| `landing_domain` | Parsed from location | ✅ | For multi-domain setups, identifies which properties drive the best engagement. | N/A (tracking, not targeting) |
| `landing_path` | Parsed from location | ✅ | Enables page-level engagement analysis—product pages vs blog posts vs homepage may have vastly different time spent patterns. | N/A (tracking, not targeting) |
| `utm_source` | URL param | ✅ | **Primary campaign attribution dimension**—compare time spent across Google, Facebook, email, affiliates to optimize ad spend on engaged traffic. | ✅ Auto-tagged by both platforms (gclid, fbclid) |
| `utm_medium` | URL param | ✅ | Reveals which channel types drive engagement—often `cpc` (paid) vs `organic` vs `email` show dramatically different time spent patterns. | ✅ Auto-tagged by both platforms |
| `utm_campaign` | URL param | ✅ | Campaign-level engagement comparison—identify which messaging/offers attract users who actually engage vs quick bouncers. | ✅ Campaign structure in both platforms |
| `utm_content` | URL param | ✅ | **A/B test dimension**—compare ad creative variants to find which drives not just clicks but actual engagement and time on site. | ✅ Ad creative/variation tracking |
| `utm_term` | URL param | ✅ | For paid search, reveals which keywords attract engaged users—long-tail keywords often drive 2-3x higher time spent than generic terms. | ✅ Google (keyword targeting), ❌ Facebook |
| `utm_id` | URL param | ✅ | Links to external campaign management systems for deeper ROI analysis combining engagement with conversion data. | ✅ Both (campaign IDs) |

### Derived Dimensions

| Dimension | Logic | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|-------|-------|-------------------------------|----------------------|
| `channel_group` | Referrer + UTM rules | ❌ | **Executive-level reporting dimension**—aggregates traffic into Organic Search, Paid Search, Social, Direct, Email, Referral, Display for high-level engagement comparison. Can be derived at query time. | ✅ Both (campaign type selection) |
| `is_direct` | referrer is null/empty | ✅ | Direct traffic often represents returning users or brand-aware visitors who typically show 30-50% higher engagement than first-time visitors. | N/A (analytics only) |
| `is_organic` | referrer contains search engine | ❌ | Organic search visitors have explicit intent—they searched for something—leading to higher engagement than interruptive ads. | N/A (analytics only) |
| `is_paid` | utm_medium contains 'cpc'/'ppc' | ❌ | Paid traffic engagement benchmarks help calculate true CAC by factoring in bounce rates and session quality, not just clicks. | N/A (analytics only) |

---

## 4. SDK-Tracked Engagement Metrics

| Dimension | Tracking Method | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|-----------------|-------|-------------------------------|----------------------|
| `duration` | Timer from session start | ✅ | **The core metric**—total seconds of engagement; the primary outcome variable that all other dimensions help explain and predict. | ✅ Both (engagement audiences, custom conversions) |
| `max_scroll` | Scroll event listener | ✅ | **Content consumption depth indicator**—users who scroll 80%+ are genuinely engaged; shallow scrollers (< 20%) indicate content mismatch or poor UX. | ✅ Both (scroll depth events for audiences) |
| `page_views` | Page navigation counter | ❌ | Multi-page sessions indicate exploration intent; single-page visits may be bounces or perfectly satisfied users (context-dependent). | ✅ Both (pageview-based audiences) |
| `events_count` | Interaction counter | ❌ | Interaction density (events per minute) reveals engagement intensity—passive reading vs active clicking/exploring. | ✅ Both (event-based audiences) |
| `is_bounce` | duration < 10s OR pages = 1 | ❌ | **Quality gate metric**—high bounce rates from specific dimensions reveal problem areas; a traffic source with 80% bounces wastes ad spend. | ✅ Both (exclude bouncers from audiences) |
| `entry_page` | First pageview path | ✅ | Identifies which pages successfully capture initial attention—optimize these for maximum first-impression engagement. | ✅ Both (landing page audiences) |
| `exit_page` | Last pageview path | ✅ | Reveals where engagement breaks down—exit pages may have UX issues, missing CTAs, or simply be natural endpoints. | N/A (analytics only) |
| `time_on_page` | Per-page timer | ❌ | Page-level engagement enables content performance comparison—which articles/products hold attention longest? | ✅ Both (time on site audiences) |

---

## 5. Time Dimensions (Server-Derived)

| Dimension | Source | In DB | Why It Matters for Time Spent | Ad Platform Targeting |
|-----------|--------|-------|-------------------------------|----------------------|
| `year` | `created_at` | ✅ | Year-over-year engagement trend analysis; baseline for measuring improvement. | N/A (analytics only) |
| `month` | `created_at` | ✅ | Seasonal engagement patterns—retail sees holiday spikes, B2B sees summer dips; normalize expectations accordingly. | N/A (analytics only) |
| `day` | `created_at` | ✅ | Day-of-month patterns may reveal paycheck cycles (higher engagement around 1st/15th) or content calendar effects. | N/A (analytics only) |
| `day_of_week` | `created_at` | ✅ | **High-value pattern dimension**—weekday vs weekend engagement differs dramatically by industry; B2B dies on weekends, lifestyle content peaks. | ✅ Google (Ad Schedule), ✅ Facebook (Dayparting) |
| `week_number` | `created_at` | ✅ | Weekly cohort analysis enables trend detection smoothed over daily noise. | N/A (analytics only) |
| `hour` | `created_at` | ✅ | **Critical for scheduling optimization**—reveals when your audience is most engaged; morning commute vs lunch vs evening shows different patterns. | ✅ Google (Ad Schedule by hour), ✅ Facebook (Dayparting) |
| `quarter` | `created_at` | ❌ | Business reporting alignment; Q4 retail vs Q1 B2B budget cycles affect engagement baselines. | N/A (analytics only) |
| `is_weekend` | day_of_week in (0,6) | ✅ | Binary flag for quick weekend vs weekday engagement comparison—often 20-40% engagement difference. | ✅ Both (weekday/weekend scheduling) |

---

## 6. Current Schema

### All Fields
```sql
-- Core
id, workspace_id, created_at, updated_at, duration

-- Time dimensions
year, month, day, day_of_week, week_number, hour, is_weekend

-- Traffic source
referrer, referrer_domain, referrer_path, is_direct
landing_page, landing_domain, landing_path, entry_page, exit_page
utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_id, utm_id_from
channel

-- Screen/Viewport
screen_width, screen_height, viewport_width, viewport_height

-- Device (from UA)
browser, browser_type, os, device
user_agent, connection_type

-- Browser JS APIs
language, timezone

-- Engagement
max_scroll, sdk_version
```

### Potential Future Additions
```sql
-- Premium device detection
device_pixel_ratio Nullable(Float32),  -- Retina displays (2x, 3x)

-- Touch detection
touch_support Nullable(Bool),          -- Segment touch vs mouse

-- Engine (for debugging)
engine Nullable(String),               -- Blink, WebKit, Gecko
```

### Fields NOT Added (Unreliable in 2025)
```sql
-- ❌ os_version        -- Frozen to "Android 10" / "Windows 10"
-- ❌ browser_version   -- Only major version reliable
-- ❌ device_model      -- Frozen to "K" on Android
-- ❌ device_vendor     -- Cannot derive without model
-- ❌ cpu_architecture  -- Removed from UA
-- ❌ engine_version    -- May be frozen
-- ❌ channel_group     -- Can be derived at query time
```

---

## 7. High-Impact Dimension Combinations

For Staminads' time spent analysis, these dimension combinations reveal the most actionable insights:

| Combination | Insight Example |
|-------------|-----------------|
| `utm_source` × `device` | "Facebook mobile traffic bounces 60% but Facebook tablet converts at 2x the rate" |
| `utm_content` × `duration` | "Video ad creative drives 3x longer sessions than static banner" |
| `landing_path` × `referrer_domain` | "Blog posts from organic search get 4min avg, same posts from social get 45sec" |
| `hour` × `day_of_week` | "Tuesday 2-4pm is our engagement peak; schedule campaigns accordingly" |
| `browser_type` × `duration` | "35% of our 'traffic' is bots—excluding them doubles our real engagement metrics" |
| `device_pixel_ratio` × `duration` | "Retina display users (2x+) spend 40% more time—they're our premium segment" |
| `connection_type` × `max_scroll` | "2G users only scroll 15% on average—serve them lighter pages" |
| `language` × `landing_path` | "French users on English content bounce 80%—prioritize translation" |

---

## 8. Detection Code Examples

### Device Type Detection (Including Desktop)
```javascript
const ua = new UAParser(navigator.userAgent);
const deviceType = ua.getDevice().type || 'desktop'; // undefined → desktop
```

### Bot/Crawler Filtering
```javascript
const ua = new UAParser(navigator.userAgent);
const browserType = ua.getBrowser().type;
const isBot = ['crawler', 'fetcher', 'cli', 'module'].includes(browserType);
if (isBot) return; // Don't track engagement for bots
```

### Touch Detection (Robust)
```javascript
const hasTouch = (
  ('ontouchstart' in window) ||
  (navigator.maxTouchPoints > 0) ||
  window.matchMedia('(pointer: coarse)').matches
);
```

### Connection Type (With Fallback)
```javascript
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const connectionType = connection?.effectiveType || null; // null for Safari/Firefox
```

### Premium Device Detection
```javascript
const isPremiumDevice = (
  window.devicePixelRatio >= 2 && // Retina display
  screen.width >= 1024 // Not a budget phone
);
```

---

## 9. Ad Platform Targeting Summary

The following dimensions are directly actionable in ad platforms—Staminads can identify which segments drive the best engagement, then marketers can target or exclude those segments in their campaigns.

### High-Value Targeting Dimensions

| Dimension | Google Ads | Facebook Ads | Staminads Insight → Ad Action |
|-----------|------------|--------------|------------------------------|
| `device` | ✅ Computer/Mobile/Tablet/TV | ✅ Desktop/Mobile/Tablet | "Tablets show 80% higher time spent" → Increase tablet bid adjustment +40% |
| `os` | ✅ Android/iOS/Windows/macOS | ✅ iOS/Android with versions | "iOS users engage 25% longer" → Create iOS-only campaign variant |
| `day_of_week` | ✅ Ad Schedule | ✅ Dayparting | "Tuesday-Thursday peak engagement" → Concentrate budget on those days |
| `hour` | ✅ Ad Schedule by hour | ✅ Dayparting | "7-9 PM shows 2x engagement" → Bid +50% during evening hours |
| `language` | ⚠️ Deprecated (AI-automated) | ✅ Full control | "French speakers bounce 60% on EN content" → Create French-targeted campaign |
| `connection_type` | ✅ Wi-Fi vs carrier | ✅ Wi-Fi only option | "Wi-Fi users watch 3x more video" → Target Wi-Fi for video ads |

### Audience-Building Dimensions (via Pixel/SDK)

| Dimension | Use in Google/Facebook | Staminads Insight → Ad Action |
|-----------|------------------------|------------------------------|
| `duration` | Create engaged user audiences | "Users with 3+ min sessions" → Create lookalike of high-engagement visitors |
| `max_scroll` | Scroll depth events | "80%+ scrollers convert 5x better" → Retarget deep scrollers only |
| `page_views` | Pageview-based audiences | "3+ page sessions" → Build audience of explorers for remarketing |
| `is_bounce` | Exclude from audiences | "Exclude <10s visitors" → Remove bouncers from retargeting pools |
| `landing_path` | Page-specific audiences | "Product page visitors" → Create product-specific retargeting |

### Not Targetable (Analytics-Only Value)

These dimensions provide insights but cannot be used for ad targeting—they're purely for understanding your audience:

- `browser`, `browser_type`, `engine` - No direct targeting in either platform
- `screen_width/height`, `viewport`, `device_pixel_ratio` - Device type proxy only
- `touch_support`, `orientation`, `color_depth` - Not available
- `referrer_*`, `is_direct`, `is_organic`, `is_paid` - Analytics classification only

### Platform-Specific Notes

**Google Ads 2025 Changes:**
- Language targeting is being deprecated for Search campaigns by end of 2025
- AI will automatically show ads in detected user languages
- Display/Video campaigns retain language targeting

**Facebook Ads 2025:**
- OS version targeting available (iOS 14+, Android version ranges)
- Device vendor targeting (Apple vs Samsung vs others)
- Wi-Fi-only option for video campaigns
- No browser-level targeting

---

## Sources

- [ua-parser-js Documentation](https://docs.uaparser.dev)
- [Chrome User-Agent Reduction](https://privacysandbox.google.com/protections/user-agent)
- [MDN: Network Information API](https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API)
- [MDN: Screen Orientation API](https://developer.mozilla.org/en-US/docs/Web/API/Screen/orientation)
- [MDN: Navigator.maxTouchPoints](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints)
- [Can I Use: devicePixelRatio](https://caniuse.com/devicepixelratio) (97% support)
- [Can I Use: Network Information API](https://caniuse.com/netinfo) (70% support)
- [GA4 Dimensions & Metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)

---

*Report generated: December 2025*
