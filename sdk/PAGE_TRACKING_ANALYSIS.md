# SDK Page Tracking Analysis

## Does it track every visited page?

**Yes.** The SDK tracks all page views:
- Initial page load sends a `screen_view` event (`sdk.ts:201`)
- SPA navigation is detected via patched History API (`events/navigation.ts`)
- Tracks: `pushState`, `replaceState`, `popstate`, and `hashchange` events

## Does it track time spent on each individual page?

**Partially.** The SDK has two time-tracking mechanisms:

1. **Session-level focus time** (`focus_duration_ms`) - Total focused time for the entire session
2. **Per-page active time** (`page_active_time` in ping events, `sdk.ts:659-663`) - Resets when user navigates to a new page

**Key limitation:** The SDK tracks per-page active time, but it's sent as metadata in ping events. The backend would need to aggregate these metrics by page path to build time-per-page reports.

## What gets sent and when?

| Event Type | Trigger |
|------------|---------|
| `screen_view` | Page load + SPA navigation |
| `ping` | Heartbeat intervals (10s→20s→30s based on engagement) |
| `scroll` | At 25%, 50%, 75%, 100% milestones |
| `goal` | When `trackGoal()` is called |

The time tracking (`core/duration.ts`) only counts time when the tab is **visible AND focused** - it excludes idle time and handles edge cases like system sleep.

## Summary

The SDK **does** track visited pages and has infrastructure for per-page time tracking, but the data model aggregates focus time at the session level. Per-page time data exists in ping events but requires backend aggregation to generate time-per-page analytics.
