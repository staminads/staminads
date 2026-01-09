# Analytics API Reference

Complete reference for all metrics and dimensions available in the Staminads Analytics API.

## Overview

The analytics system supports two tables:
- **`sessions`** - Session-level aggregated data (default)
- **`pages`** - Per-page view data with duration tracking

Specify the table using the `table` parameter in API requests.

---

## Metrics

### Session Metrics (`table=sessions`)

| Metric | Description | SQL | Example |
|--------|-------------|-----|---------|
| `sessions` | Total number of sessions | `count()` | `1,234` |
| `avg_duration` | Average session duration in seconds | `round(avg(duration), 1)` | `45.3` |
| `median_duration` | Median session duration in seconds (TimeScore) | `round(median(duration), 1)` | `38.0` |
| `max_scroll` | Average max scroll depth percentage | `round(avg(max_scroll), 1)` | `67.2` |
| `median_scroll` | Median max scroll depth percentage | `round(median(max_scroll), 1)` | `72.0` |
| `bounce_rate` | Percentage of sessions under bounce threshold | `round(countIf(duration < N) * 100.0 / count(), 2)` | `34.56` |
| `pageviews` | Total pageviews across all sessions | `countIf(name = 'screen_view')` | `3,456` |
| `pages_per_session` | Average pages viewed per session | `round(avg(pageview_count), 2)` | `2.81` |
| `median_page_duration` | Session-weighted median time on page (seconds) | `round(median(median_page_duration), 1)` | `23.0` |

#### Metric Details

**`median_duration` (TimeScore)**
- The primary engagement metric shown on dashboards
- Represents the median time users spend actively engaged in a session
- More robust than average as it's not skewed by outliers
- Example: If sessions have durations [10, 20, 30, 120, 300], median is 30s

**`bounce_rate`**
- Configurable bounce threshold (default: 10 seconds)
- Sessions shorter than threshold are considered "bounces"
- Lower is generally better

**`median_page_duration`**
- Session-weighted: each session contributes equally regardless of page count
- Uses median for robustness against outlier sessions
- Useful for comparing engagement quality across traffic sources
- Different from `page_duration` (pages table) which is page-weighted

---

### Page Metrics (`table=pages`)

| Metric | Description | SQL | Example |
|--------|-------------|-----|---------|
| `page_count` | Total page views | `count()` | `5,678` |
| `unique_pages` | Number of unique page paths | `uniqExact(path)` | `42` |
| `page_duration` | Median time on page in seconds | `round(median(duration), 1)` | `28.0` |
| `page_scroll` | Median scroll depth percentage | `round(median(max_scroll), 1)` | `65.0` |
| `landing_page_count` | Number of landing page views | `countIf(is_landing = true)` | `1,234` |
| `exit_page_count` | Number of exit page views | `countIf(is_exit = true)` | `1,234` |
| `exit_rate` | Percentage of views that are exits | `round(countIf(is_exit = true) * 100.0 / count(), 2)` | `45.67` |

#### Metric Details

**`page_duration`**
- True per-page metric: each page view contributes equally
- Uses median for robustness against outliers
- Best for answering "how engaging is this specific page?"

**`exit_rate`**
- Percentage of page views where the user left the site
- High exit rate on a checkout page = problem
- High exit rate on a "thank you" page = expected

---

## Dimensions

### Traffic Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `referrer` | `referrer` | string | Full referrer URL | `https://google.com/search?q=...` |
| `referrer_domain` | `referrer_domain` | string | Referrer domain only | `google.com`, `facebook.com` |
| `referrer_path` | `referrer_path` | string | Referrer URL path | `/search`, `/posts/123` |
| `is_direct` | `is_direct` | boolean | Whether traffic is direct (no referrer) | `true`, `false` |

---

### UTM Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `utm_source` | `utm_source` | string | Traffic source | `google`, `newsletter`, `facebook` |
| `utm_medium` | `utm_medium` | string | Marketing medium | `cpc`, `email`, `social`, `organic` |
| `utm_campaign` | `utm_campaign` | string | Campaign name | `summer_sale`, `product_launch` |
| `utm_term` | `utm_term` | string | Paid search keywords | `running shoes`, `analytics tool` |
| `utm_content` | `utm_content` | string | Ad content identifier | `banner_v1`, `text_link` |

---

### Channel Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `channel` | `channel` | string | Traffic channel | `Organic Search`, `Paid Search`, `Direct` |
| `channel_group` | `channel_group` | string | Channel grouping | `Search`, `Social`, `Referral`, `Direct` |

**Channel Values:**
- `Direct` - No referrer, typed URL
- `Organic Search` - Google, Bing, etc. without ads
- `Paid Search` - Google Ads, Bing Ads
- `Social` - Facebook, Twitter, LinkedIn, etc.
- `Referral` - Links from other websites
- `Email` - Email campaigns
- `Display` - Display advertising

---

### Session Pages Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `landing_page` | `landing_page` | string | Full landing page URL | `https://example.com/products` |
| `landing_domain` | `landing_domain` | string | Landing page domain | `example.com`, `blog.example.com` |
| `landing_path` | `landing_path` | string | Landing page path | `/`, `/products`, `/blog/post-1` |
| `exit_path` | `exit_path` | string | Last page path in session | `/checkout`, `/thank-you` |

---

### Page Dimensions (`pages` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `page_path` | `path` | string | Page URL path | `/`, `/products`, `/about` |
| `page_number` | `page_number` | number | Position in session sequence | `1`, `2`, `3` (currently always `1`) |
| `is_landing_page` | `is_landing` | boolean | Whether this was the entry page | `true`, `false` |
| `is_exit_page` | `is_exit` | boolean | Whether this was the exit page | `true`, `false` |
| `page_entry_type` | `entry_type` | string | How user arrived at page | `landing`, `navigation` |

**Note:** `page_number` is currently hardcoded to `1` due to materialized view limitations.

---

### Device Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `device` | `device` | string | Device category | `desktop`, `mobile`, `tablet` |
| `browser` | `browser` | string | Browser name | `Chrome`, `Safari`, `Firefox`, `Edge` |
| `browser_type` | `browser_type` | string | Browser engine type | `chromium`, `webkit`, `gecko` |
| `os` | `os` | string | Operating system | `Windows`, `macOS`, `iOS`, `Android`, `Linux` |
| `screen_width` | `screen_width` | number | Screen width in pixels | `1920`, `1440`, `375` |
| `screen_height` | `screen_height` | number | Screen height in pixels | `1080`, `900`, `812` |
| `viewport_width` | `viewport_width` | number | Browser viewport width | `1920`, `1200`, `375` |
| `viewport_height` | `viewport_height` | number | Browser viewport height | `969`, `800`, `667` |
| `connection_type` | `connection_type` | string | Network connection type | `4g`, `3g`, `wifi`, `slow-2g` |

---

### Time Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `year` | `year` | number | Year of session | `2024`, `2025`, `2026` |
| `month` | `month` | number | Month (1-12) | `1`, `6`, `12` |
| `day` | `day` | number | Day of month (1-31) | `1`, `15`, `31` |
| `day_of_week` | `day_of_week` | number | Day of week (1=Monday, 7=Sunday) | `1`, `5`, `7` |
| `week_number` | `week_number` | number | ISO week number (1-53) | `1`, `26`, `52` |
| `hour` | `hour` | number | Hour of day (0-23) | `0`, `12`, `23` |
| `is_weekend` | `is_weekend` | boolean | Whether session was on weekend | `true`, `false` |

---

### Geographic Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `country` | `country` | string | Country code (ISO 3166-1 alpha-2) | `US`, `GB`, `FR`, `DE`, `JP` |
| `region` | `region` | string | Region/state | `California`, `England`, `Île-de-France` |
| `city` | `city` | string | City name | `San Francisco`, `London`, `Paris` |
| `latitude` | `latitude` | number | Latitude coordinate | `37.7749`, `51.5074` |
| `longitude` | `longitude` | number | Longitude coordinate | `-122.4194`, `-0.1278` |
| `language` | `language` | string | Browser language | `en-US`, `fr-FR`, `de-DE`, `ja-JP` |
| `timezone` | `timezone` | string | User timezone | `America/Los_Angeles`, `Europe/London` |

---

### Session Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `duration` | `duration` | number | Session duration in seconds | `0`, `30`, `120`, `600` |
| `pageview_count` | `pageview_count` | number | Pages viewed in session | `1`, `3`, `10` |

---

### Custom Dimensions (`sessions` table)

| Dimension | Column | Type | Description | Example Values |
|-----------|--------|------|-------------|----------------|
| `stm_1` | `stm_1` | string | Custom dimension 1 | User-defined |
| `stm_2` | `stm_2` | string | Custom dimension 2 | User-defined |
| `stm_3` | `stm_3` | string | Custom dimension 3 | User-defined |
| `stm_4` | `stm_4` | string | Custom dimension 4 | User-defined |
| `stm_5` | `stm_5` | string | Custom dimension 5 | User-defined |
| `stm_6` | `stm_6` | string | Custom dimension 6 | User-defined |
| `stm_7` | `stm_7` | string | Custom dimension 7 | User-defined |
| `stm_8` | `stm_8` | string | Custom dimension 8 | User-defined |
| `stm_9` | `stm_9` | string | Custom dimension 9 | User-defined |
| `stm_10` | `stm_10` | string | Custom dimension 10 | User-defined |

Custom dimensions can be set in two ways:

**1. Via URL parameters (automatic)**
```
https://example.com/page?stm_1=campaign_a&stm_2=variant_b
```
URL parameters `stm_1` through `stm_10` are automatically captured on SDK initialization.
Existing dimension values take priority over URL parameters.

**2. Via SDK (programmatic)**
```javascript
Staminads.setDimension(1, 'premium');      // stm_1 = 'premium'
Staminads.setDimension(2, 'logged_in');    // stm_2 = 'logged_in'
```

---

## API Usage Examples

### Basic Session Query
```json
{
  "table": "sessions",
  "metrics": ["sessions", "median_duration", "bounce_rate"],
  "dimensions": ["landing_path"],
  "dateRange": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-07T23:59:59Z"
  },
  "limit": 10
}
```

### Per-Page Duration Analysis
```json
{
  "table": "pages",
  "metrics": ["page_count", "page_duration", "exit_rate"],
  "dimensions": ["page_path"],
  "dateRange": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-07T23:59:59Z"
  },
  "order": { "page_count": "desc" },
  "limit": 20
}
```

### Traffic Source Comparison
```json
{
  "table": "sessions",
  "metrics": ["sessions", "median_duration", "median_page_duration", "pages_per_session"],
  "dimensions": ["utm_source"],
  "filters": [
    { "dimension": "utm_source", "operator": "is_not", "values": [""] }
  ],
  "dateRange": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-31T23:59:59Z"
  }
}
```

### Time Series with Granularity
```json
{
  "table": "sessions",
  "metrics": ["sessions", "median_duration"],
  "dateRange": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-07T23:59:59Z",
    "granularity": "day"
  }
}
```

---

## Metric Selection Guide

| Question | Recommended Metrics | Table |
|----------|---------------------|-------|
| How many visitors? | `sessions` | sessions |
| How engaged are users? | `median_duration`, `median_scroll` | sessions |
| Are users bouncing? | `bounce_rate` | sessions |
| Which pages perform best? | `page_duration`, `page_scroll` | pages |
| Where do users exit? | `exit_rate`, `exit_page_count` | pages |
| Traffic source quality? | `median_page_duration`, `pages_per_session` | sessions |
| Content depth? | `pages_per_session`, `max_scroll` | sessions |

---

## Notes

1. **Table Selection**: Most queries use `sessions` (default). Use `pages` for per-page analysis.

2. **Metric-Dimension Compatibility**: Metrics and dimensions must be from the same table. The API will error if you mix them.

3. **Filters**: Can filter on any dimension from the selected table.

4. **Granularity**: Time series queries support `hour`, `day`, `week`, `month`, `year`.

5. **Bounce Threshold**: The `bounce_rate` metric uses a configurable threshold (workspace setting, default 10 seconds).
