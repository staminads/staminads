# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-01-07

### Breaking Changes
- Database schema updated with new columns and tables
- Migration will DROP and recreate workspace tables (events, sessions, pages)
- Requires data backup before upgrading (see releases/v3.0.0.md)

### New Features
- **Pageview Count**: Track number of pages viewed per session
- **Page Duration**: Track time spent on each individual page
- **Pages Table**: New dedicated table for per-page analytics with materialized view

### SDK Bug Fixes
- Fixed `onNavigation()` to capture page duration BEFORE resetting timer
- Fixed `flushOnce()` to include page duration in final unload ping

### New Metrics
- `pageviews` - Total pageviews (screen_view events)
- `pages_per_session` - Average pages viewed per session
- `median_page_duration` - Median time spent on each page (robust to outliers)

## [2.4.0] - 2026-01-07

- Fix all ESLint errors and warnings in API

## [2.3.0] - 2026-01-07

- Topbar logo now navigates to dashboard

## [2.2.0] - 2026-01-07

- Mobile UI enhancements for dashboard and explore views

## [2.0.0] - 2025-01-06

- Release new open source v2.0.0
