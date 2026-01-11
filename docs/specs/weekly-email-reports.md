# Weekly Email Reports Specification

## Overview

Weekly email reports provide automated traffic intelligence summaries to workspace members, highlighting significant changes, new opportunities, and performance trends. Reports are designed to surface actionable insights without requiring users to log into the dashboard.

## Goals

1. **Reduce time-to-insight** - Deliver key metrics directly to users' inboxes
2. **Surface significant changes** - Highlight traffic anomalies (both positive and negative)
3. **Identify new opportunities** - Detect new traffic sources and channels
4. **Track goal performance** - Monitor conversion trends and goal value evolution
5. **Drive engagement** - Encourage users to investigate noteworthy changes

## Report Sections

### 1. Executive Summary

A high-level snapshot of the week's performance with week-over-week comparison.

| Metric | Description | Source |
|--------|-------------|--------|
| Total Sessions | Session count with WoW change % | `sessions` metric |
| Bounce Rate | Bounce rate with WoW change | `bounce_rate` metric |
| Avg. Duration | Average session duration with WoW change | `avg_duration` metric |
| Total Pageviews | Pageview count with WoW change | `pageviews` metric |
| Pages/Session | Average pages per session with WoW change | `pages_per_session` metric |
| Goals Completed | Total goal conversions with WoW change | `goals` metric |
| Goal Value | Total goal value with WoW change | `sum_goal_value` metric |

**Visual Indicator**: Traffic trend arrow (↑↓→) with color coding:
- Green (↑): Improvement > 5%
- Red (↓): Decline > 5%
- Gray (→): Stable (-5% to +5%)

### 2. Traffic Changes - Top Movers

Display the most significant traffic changes by source, highlighting both gains and losses.

#### Top 5 Growth Sources
Sources with the highest **absolute session increase** compared to the previous week.

| Column | Description |
|--------|-------------|
| Source | `referrer_domain` or "Direct" if `is_direct = true` |
| Sessions | Current week session count |
| Change | Absolute change vs. previous week |
| % Change | Percentage change |
| Trend Spark | Mini sparkline showing 4-week trend |

**Inclusion criteria**:
- Minimum 10 sessions in current week
- Positive change vs. previous week
- Ordered by absolute session increase

#### Top 5 Declining Sources
Sources with the highest **absolute session decrease** compared to the previous week.

| Column | Description |
|--------|-------------|
| Source | `referrer_domain` or "Direct" |
| Sessions | Current week session count |
| Change | Absolute change vs. previous week |
| % Change | Percentage change |
| Previous | Previous week session count |

**Inclusion criteria**:
- Had minimum 10 sessions in previous week
- Negative change vs. previous week
- Ordered by absolute session decrease (most negative first)

### 3. New Traffic Sources

Sources that appeared for the **first time** in the current week (not seen in the previous 4 weeks).

| Column | Description |
|--------|-------------|
| Source | `referrer_domain` |
| Sessions | Session count this week |
| Bounce Rate | Bounce rate for this source |
| Avg. Duration | Average session duration |
| Top Landing Page | Most common `landing_path` |

**Inclusion criteria**:
- Zero sessions from this `referrer_domain` in previous 28 days
- Minimum 5 sessions in current week
- Limited to top 10 new sources by session count

### 4. Channel Performance

Performance breakdown by marketing channel with week-over-week comparison.

| Channel | Sessions | WoW % | Bounce Rate | Avg. Duration | Goals |
|---------|----------|-------|-------------|---------------|-------|
| Organic Search | 1,234 | +12% | 45% | 2m 30s | 45 |
| Direct | 890 | -5% | 52% | 1m 45s | 23 |
| Social | 456 | +25% | 38% | 3m 15s | 12 |
| Referral | 234 | +8% | 41% | 2m 50s | 8 |
| Email | 123 | -15% | 35% | 4m 00s | 15 |
| Paid Search | 89 | +3% | 48% | 2m 10s | 6 |

**Dimension used**: `channel_group`

**Highlight rules**:
- Bold channels with > 20% change
- Green/red indicators for significant changes

### 5. UTM Campaign Performance

Performance of tracked marketing campaigns (UTM-tagged traffic).

| Campaign | Source/Medium | Sessions | WoW % | Goals | Conversion Rate |
|----------|---------------|----------|-------|-------|-----------------|
| spring_sale | google/cpc | 234 | +45% | 12 | 5.1% |
| newsletter_jan | email/newsletter | 189 | -8% | 23 | 12.2% |

**Dimensions used**: `utm_campaign`, `utm_source`, `utm_medium`

**Inclusion criteria**:
- Has non-empty `utm_campaign`
- Minimum 20 sessions in current or previous week
- Top 10 by session count

### 6. Goal Performance

Detailed breakdown of goal conversions and values.

#### Goals Summary
| Goal Name | Completions | WoW % | Total Value | Avg. Value |
|-----------|-------------|-------|-------------|------------|
| Purchase | 45 | +15% | $4,500 | $100 |
| Sign Up | 123 | -3% | - | - |
| Contact Form | 67 | +22% | - | - |

**Dimension used**: `goal_name`
**Metrics used**: `goals`, `sum_goal_value`, `avg_goal_value`

#### Goal Conversion by Channel
| Channel | Goals | Conversion Rate | WoW Change |
|---------|-------|-----------------|------------|
| Email | 45 | 12.5% | +2.3pp |
| Organic | 34 | 3.2% | -0.5pp |

*Conversion rate = goals / sessions × 100*

### 7. Top Content Performance

Best and worst performing pages for the week.

#### Top 5 Landing Pages (by sessions)
| Page | Sessions | Bounce Rate | Avg. Duration |
|------|----------|-------------|---------------|
| /products | 456 | 32% | 3m 20s |
| / | 345 | 48% | 1m 30s |

**Dimension used**: `landing_path`

#### Pages with Highest Exit Rate
| Page | Exit Rate | Page Views | Avg. Duration |
|------|-----------|------------|---------------|
| /checkout | 78% | 234 | 45s |

**Dimension used**: `page_path`
**Metric used**: `exit_rate`

### 8. Geographic Insights

Top countries by traffic with performance comparison.

| Country | Sessions | WoW % | Bounce Rate | Goals |
|---------|----------|-------|-------------|-------|
| US | 2,345 | +8% | 42% | 89 |
| UK | 567 | +12% | 38% | 23 |

**Dimension used**: `country`
**Show**: Top 5 countries by session count

### 9. Device Performance

Traffic breakdown by device type.

| Device | Sessions | Share | Bounce Rate | Pages/Session |
|--------|----------|-------|-------------|---------------|
| Desktop | 1,890 | 58% | 38% | 4.2 |
| Mobile | 1,234 | 38% | 52% | 2.1 |
| Tablet | 123 | 4% | 45% | 3.5 |

**Dimension used**: `device`

### 10. Insights & Anomalies (AI-Powered - Future)

*Phase 2 feature*

Automatically detected patterns and anomalies:
- "Traffic from LinkedIn increased 156% - first time above 100 sessions"
- "Bounce rate on /pricing spiked from 35% to 68%"
- "New high-converting source: partner.example.com (15% conversion rate)"

## Report Configuration

### Workspace Settings

```typescript
interface WeeklyReportSettings {
  enabled: boolean;                    // Enable/disable reports
  schedule: {
    dayOfWeek: 0-6;                    // 0 = Sunday, 1 = Monday (default)
    hour: number;                       // Hour in workspace timezone (default: 9)
  };
  recipients: {
    allMembers: boolean;               // Send to all workspace members
    additionalEmails: string[];        // External recipients
    excludeMembers: string[];          // Member IDs to exclude
  };
  sections: {
    executiveSummary: boolean;         // Default: true
    trafficChanges: boolean;           // Default: true
    newSources: boolean;               // Default: true
    channelPerformance: boolean;       // Default: true
    utmCampaigns: boolean;             // Default: true
    goalPerformance: boolean;          // Default: true (if goals exist)
    topContent: boolean;               // Default: true
    geoInsights: boolean;              // Default: false
    devicePerformance: boolean;        // Default: false
  };
  thresholds: {
    significantChangePercent: number;  // Default: 20 (highlight changes > 20%)
    minSessionsForSource: number;      // Default: 10
    minSessionsForNewSource: number;   // Default: 5
  };
  comparison: {
    period: 'previous_week' | 'same_week_last_month' | 'same_week_last_year';
  };
}
```

### User Preferences

Individual users can override workspace settings:

```typescript
interface UserReportPreferences {
  optOut: boolean;                     // User opted out of reports
  format: 'full' | 'summary';          // Full report or executive summary only
  frequency: 'weekly' | 'daily';       // Override to daily digest (future)
}
```

## Technical Implementation

### Database Schema

#### New Table: `weekly_report_subscriptions`

```sql
CREATE TABLE staminads_system.weekly_report_subscriptions
(
    id UUID DEFAULT generateUUIDv4(),
    workspace_id UUID,
    email String,
    user_id Nullable(UUID),            -- NULL for external recipients
    is_active UInt8 DEFAULT 1,
    preferences String DEFAULT '{}',   -- JSON UserReportPreferences
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3),
    sign Int8 DEFAULT 1
)
ENGINE = CollapsingMergeTree(sign)
ORDER BY (workspace_id, email)
```

#### New Table: `weekly_report_logs`

```sql
CREATE TABLE staminads_system.weekly_report_logs
(
    id UUID DEFAULT generateUUIDv4(),
    workspace_id UUID,
    report_date Date,                  -- Monday of the reported week
    sent_at DateTime64(3),
    recipient_count UInt32,
    status Enum8('pending' = 0, 'sent' = 1, 'failed' = 2),
    error_message Nullable(String),
    report_data String,                -- JSON snapshot of report data
    generation_time_ms UInt32
)
ENGINE = MergeTree()
ORDER BY (workspace_id, report_date)
TTL sent_at + INTERVAL 90 DAY
```

### API Endpoints

#### Report Settings Management

```
POST /api/reports.weekly.settings.get
POST /api/reports.weekly.settings.update
POST /api/reports.weekly.preview        -- Generate preview for current user
POST /api/reports.weekly.send           -- Manually trigger report (admin)
POST /api/reports.weekly.unsubscribe    -- User opts out
POST /api/reports.weekly.subscribe      -- User opts back in
GET  /api/reports.weekly.history        -- List sent reports
```

### Scheduled Job

Using `@nestjs/schedule` with cron expressions:

```typescript
@Injectable()
export class WeeklyReportScheduler {
  // Run every Monday at each hour to check workspace timezones
  @Cron('0 * * * 1')
  async processWeeklyReports() {
    // Get all workspaces where current UTC hour matches their
    // configured send hour in their timezone
    const workspaces = await this.getWorkspacesForCurrentHour();

    for (const workspace of workspaces) {
      await this.generateAndSendReport(workspace);
    }
  }
}
```

### Report Generation Service

```typescript
@Injectable()
export class WeeklyReportService {
  async generateReport(workspaceId: string, weekStart: Date): Promise<WeeklyReportData> {
    const dateRange = {
      start: weekStart,
      end: addDays(weekStart, 7)
    };
    const previousRange = {
      start: addDays(weekStart, -7),
      end: weekStart
    };

    // Parallel data fetching
    const [
      summary,
      topGrowthSources,
      declingSources,
      newSources,
      channelPerformance,
      campaigns,
      goals,
      topPages,
      geoData,
      deviceData
    ] = await Promise.all([
      this.getExecutiveSummary(workspaceId, dateRange, previousRange),
      this.getTopGrowthSources(workspaceId, dateRange, previousRange),
      this.getDecliningSources(workspaceId, dateRange, previousRange),
      this.getNewSources(workspaceId, dateRange),
      this.getChannelPerformance(workspaceId, dateRange, previousRange),
      this.getCampaignPerformance(workspaceId, dateRange, previousRange),
      this.getGoalPerformance(workspaceId, dateRange, previousRange),
      this.getTopPages(workspaceId, dateRange),
      this.getGeoInsights(workspaceId, dateRange, previousRange),
      this.getDevicePerformance(workspaceId, dateRange)
    ]);

    return { summary, topGrowthSources, /* ... */ };
  }
}
```

### Email Template

New Handlebars template: `weekly-report.html`

Structure:
- Header with workspace name and report period
- Executive summary cards (responsive grid)
- Collapsible sections for each report area
- Tables with alternating row colors
- Trend indicators with colored badges
- Footer with unsubscribe link and settings link

**Design considerations**:
- Mobile-first responsive design
- Dark mode support via `@media (prefers-color-scheme: dark)`
- Inline CSS for email client compatibility
- Maximum width: 600px
- Font: System font stack

## UI Components

### Settings Page

Location: `/settings/reports`

Features:
- Toggle weekly reports on/off
- Configure schedule (day and time)
- Select/deselect sections
- Manage recipients (members + external emails)
- Preview button to see sample report
- Send test report button

### Report History

Location: `/settings/reports/history`

- List of sent reports with date and recipient count
- View archived report data
- Resend to specific recipients

### User Preferences

Location: User menu → "Email Preferences"

- Opt out of weekly reports
- Choose format (full/summary)

## Rollout Plan

### Phase 1: MVP (Week 1-2)
- [ ] Database schema for subscriptions and logs
- [ ] Basic report generation with core sections:
  - Executive summary
  - Traffic changes (growth/decline)
  - New sources
  - Channel performance
- [ ] Email template (basic styling)
- [ ] Scheduled job infrastructure
- [ ] Settings API endpoints
- [ ] Basic settings UI

### Phase 2: Enhanced Reports (Week 3-4)
- [ ] Goal performance section
- [ ] UTM campaign tracking
- [ ] Top content section
- [ ] Improved email template design
- [ ] Report preview functionality
- [ ] Report history and logs

### Phase 3: Advanced Features (Week 5-6)
- [ ] Geographic insights
- [ ] Device performance
- [ ] User preferences (opt-out, format)
- [ ] External recipients
- [ ] Threshold customization

### Phase 4: Intelligence (Future)
- [ ] AI-powered anomaly detection
- [ ] Natural language insights
- [ ] Trend predictions
- [ ] Custom alerts based on thresholds

## Success Metrics

1. **Adoption**: % of workspaces with weekly reports enabled
2. **Engagement**: Email open rate and click-through rate
3. **Retention**: User login frequency after receiving reports
4. **Usefulness**: User feedback and NPS for reports feature

## Security Considerations

1. **Unsubscribe tokens**: Signed tokens to prevent enumeration attacks
2. **External recipients**: Require email verification before adding
3. **Data exposure**: Reports only include aggregated metrics, no PII
4. **Rate limiting**: Maximum 1 manual send per hour per workspace

## References

- [Metrics Watch - Weekly Marketing Reports](https://metricswatch.com/weekly-marketing-reports)
- [GA4 Scheduled Reports](https://support.google.com/analytics/answer/13722168)
- [Bloomreach - Email Marketing Analytics](https://www.bloomreach.com/en/blog/email-marketing-analytics-deep-dive-metrics)
- [DashThis - Web Analytics Report Template](https://dashthis.com/web-analytics-report-template/)
- [Analytify - GA4 Email Reports 2025](https://analytify.io/google-analytics-email-reports/)
