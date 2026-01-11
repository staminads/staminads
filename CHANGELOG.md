# Changelog

All notable changes to this project will be documented in this file.

## [4.2.0] - 2026-01-11

- Fix weekly granularity comparison showing 0 sessions for previous period
- Use daily granularity by default for periods under 4 months

## [4.1.0] - 2026-01-11

- Fix expired JWT token handling - redirect to logout on 401 responses
- Add public /logout route
- Increase default JWT expiration from 7 to 14 days

## [4.0.0] - 2026-01-10

### Breaking Changes

**Complete data reset required.** V4 introduces a new SDK payload format and events table schema. There is no backward compatibility from V3 - all existing data will be deleted during migration.

- New SDK V3 payload format: `actions[]` array replaces `current_page` and checkpoint-based syncing
- New events table schema with updated field structure
- Simplified SDK state management (no more `attributesSent` flag)
- Attributes always sent with every payload for reliability

### Migration

When upgrading from V3 to V4:
1. All workspace databases will be dropped
2. All system database tables will be cleared (except migration settings)
3. Fresh tables will be created on startup
4. All analytics data will be lost - export before upgrading if needed

## [3.3.0] - 2026-01-10

- Add Privacy settings tab with geo privacy controls (enable/disable geo tracking, city/region storage, coordinates precision)
- Add default traffic source filters for new workspaces (39 filters covering Google, Facebook, Instagram, LinkedIn, TikTok, Pinterest, Twitter/X, Snapchat, Reddit, Quora, and more)

## [3.2.0] - 2026-01-10

First public release of Staminads web analytics platform.
