# Custom Reports Specification

## Overview

Custom reports allow workspace editors to create personalized analytics reports with configurable widgets, date ranges, and delivery schedules. Reports can be viewed in-app or delivered via email to selected recipients.

## Goals

1. **Empower users** - Let editors create reports tailored to their specific needs
2. **Flexible delivery** - View in-app or receive via email at chosen frequency
3. **Collaborative sharing** - Share reports with team members and external stakeholders
4. **Reduce time-to-insight** - Automate recurring analytics tasks
5. **Surface significant changes** - Highlight traffic anomalies and trends

## Report Sections

### 1. Executive Summary

A high-level snapshot of the week's performance with week-over-week comparison.

| Metric          | Description                               | Source                     |
| --------------- | ----------------------------------------- | -------------------------- |
| Total Sessions  | Session count with WoW change %           | `sessions` metric          |
| Bounce Rate     | Bounce rate with WoW change               | `bounce_rate` metric       |
| Median Duration | Median session duration with WoW change   | `median_duration` metric   |
| Total Pageviews | Pageview count with WoW change            | `pageviews` metric         |
| Pages/Session   | Average pages per session with WoW change | `pages_per_session` metric |
| Goals Completed | Total goal conversions with WoW change    | `goals` metric             |
| Goal Value      | Total goal value with WoW change          | `sum_goal_value` metric    |

**Visual Indicator**: Traffic trend arrow (↑↓→) with color coding:

- Green (↑): Improvement > 5%
- Red (↓): Decline > 5%
- Gray (→): Stable (-5% to +5%)

### 2. Traffic Changes - Top Movers

Display the most significant traffic changes by source, highlighting both gains and losses.

#### Top 5 Growth Sources

Sources with the highest **absolute session increase** compared to the previous week.

| Column      | Description                                         |
| ----------- | --------------------------------------------------- |
| Source      | `referrer_domain` or "Direct" if `is_direct = true` |
| Sessions    | Current week session count                          |
| Change      | Absolute change vs. previous week                   |
| % Change    | Percentage change                                   |
| Trend Spark | Mini sparkline showing 4-week trend                 |

**Inclusion criteria**:

- Minimum 10 sessions in current week
- Positive change vs. previous week
- Ordered by absolute session increase

#### Top 5 Declining Sources

Sources with the highest **absolute session decrease** compared to the previous week.

| Column   | Description                       |
| -------- | --------------------------------- |
| Source   | `referrer_domain` or "Direct"     |
| Sessions | Current week session count        |
| Change   | Absolute change vs. previous week |
| % Change | Percentage change                 |
| Previous | Previous week session count       |

**Inclusion criteria**:

- Had minimum 10 sessions in previous week
- Negative change vs. previous week
- Ordered by absolute session decrease (most negative first)

### 3. New Traffic Sources

Sources that appeared for the **first time** in the current week (not seen in the previous 4 weeks).

| Column           | Description                 |
| ---------------- | --------------------------- |
| Source           | `referrer_domain`           |
| Sessions         | Session count this week     |
| Bounce Rate      | Bounce rate for this source |
| Avg. Duration    | Average session duration    |
| Top Landing Page | Most common `landing_path`  |

**Inclusion criteria**:

- Zero sessions from this `referrer_domain` in previous 28 days
- Minimum 5 sessions in current week
- Limited to top 10 new sources by session count

### 4. Channel Performance

Performance breakdown by marketing channel with week-over-week comparison.

| Channel        | Sessions | WoW % | Bounce Rate | Avg. Duration | Goals |
| -------------- | -------- | ----- | ----------- | ------------- | ----- |
| Organic Search | 1,234    | +12%  | 45%         | 2m 30s        | 45    |
| Direct         | 890      | -5%   | 52%         | 1m 45s        | 23    |
| Social         | 456      | +25%  | 38%         | 3m 15s        | 12    |
| Referral       | 234      | +8%   | 41%         | 2m 50s        | 8     |
| Email          | 123      | -15%  | 35%         | 4m 00s        | 15    |
| Paid Search    | 89       | +3%   | 48%         | 2m 10s        | 6     |

**Dimension used**: `channel_group`

**Highlight rules**:

- Bold channels with > 20% change
- Green/red indicators for significant changes

### 5. UTM Campaign Performance

Performance of tracked marketing campaigns (UTM-tagged traffic).

| Campaign       | Source/Medium    | Sessions | WoW % | Goals | Conversion Rate |
| -------------- | ---------------- | -------- | ----- | ----- | --------------- |
| spring_sale    | google/cpc       | 234      | +45%  | 12    | 5.1%            |
| newsletter_jan | email/newsletter | 189      | -8%   | 23    | 12.2%           |

**Dimensions used**: `utm_campaign`, `utm_source`, `utm_medium`

**Inclusion criteria**:

- Has non-empty `utm_campaign`
- Minimum 20 sessions in current or previous week
- Top 10 by session count

### 6. Goal Performance

Detailed breakdown of goal conversions and values.

#### Goals Summary

| Goal Name    | Completions | WoW % | Total Value | Avg. Value |
| ------------ | ----------- | ----- | ----------- | ---------- |
| Purchase     | 45          | +15%  | $4,500      | $100       |
| Sign Up      | 123         | -3%   | -           | -          |
| Contact Form | 67          | +22%  | -           | -          |

**Dimension used**: `goal_name`
**Metrics used**: `goals`, `sum_goal_value`, `avg_goal_value`

#### Goal Conversion by Channel

| Channel | Goals | Conversion Rate | WoW Change |
| ------- | ----- | --------------- | ---------- |
| Email   | 45    | 12.5%           | +2.3pp     |
| Organic | 34    | 3.2%            | -0.5pp     |

_Conversion rate = goals / sessions × 100_

### 7. Top Content Performance

Best and worst performing pages for the week.

#### Top 5 Landing Pages (by sessions)

| Page      | Sessions | Bounce Rate | Avg. Duration |
| --------- | -------- | ----------- | ------------- |
| /products | 456      | 32%         | 3m 20s        |
| /         | 345      | 48%         | 1m 30s        |

**Dimension used**: `landing_path`

#### Pages with Highest Exit Rate

| Page      | Exit Rate | Page Views | Avg. Duration |
| --------- | --------- | ---------- | ------------- |
| /checkout | 78%       | 234        | 45s           |

**Dimension used**: `page_path`
**Metric used**: `exit_rate`

### 8. Geographic Insights

Top countries by traffic with performance comparison.

| Country | Sessions | WoW % | Bounce Rate | Goals |
| ------- | -------- | ----- | ----------- | ----- |
| US      | 2,345    | +8%   | 42%         | 89    |
| UK      | 567      | +12%  | 38%         | 23    |

**Dimension used**: `country`
**Show**: Top 5 countries by session count

### 9. Device Performance

Traffic breakdown by device type.

| Device  | Sessions | Share | Bounce Rate | Pages/Session |
| ------- | -------- | ----- | ----------- | ------------- |
| Desktop | 1,890    | 58%   | 38%         | 4.2           |
| Mobile  | 1,234    | 38%   | 52%         | 2.1           |
| Tablet  | 123      | 4%    | 45%         | 3.5           |

**Dimension used**: `device`

### 10. Insights & Anomalies (AI-Powered - Future)

_Phase 2 feature_

Automatically detected patterns and anomalies:

- "Traffic from LinkedIn increased 156% - first time above 100 sessions"
- "Bounce rate on /pricing spiked from 35% to 68%"
- "New high-converting source: partner.example.com (15% conversion rate)"

## Report Configuration

### Report Entity

Each report is created and owned by an editor user.

```typescript
interface Report {
  id: string;                          // UUID
  workspace_id: string;                // Parent workspace
  created_by: string;                  // User ID of creator (editor role required)
  name: string;                        // Report name (e.g., "Weekly Traffic Summary")
  description?: string;                // Optional description

  // Widget configuration
  widgets: ReportWidget[];             // Ordered list of widgets to include

  // Date range configuration
  dateRange: {
    preset: DatePreset;                // Relative date range
    comparison: ComparisonType;        // What to compare against
  };

  // Email delivery configuration
  emailDelivery: {
    enabled: boolean;                  // Enable email delivery
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: 0-6;                   // For weekly: 0=Sunday, 1=Monday (default)
    dayOfMonth?: 1-28;                 // For monthly: day of month
    hour: number;                      // Hour in workspace timezone (0-23)
  };

  // Recipients (managed by editors)
  recipients: ReportRecipient[];

  // Metadata
  created_at: Date;
  updated_at: Date;
  last_sent_at?: Date;
  last_viewed_at?: Date;
}

type DatePreset =
  | 'previous_7_days'
  | 'previous_14_days'
  | 'previous_28_days'
  | 'previous_30_days'
  | 'previous_week'      // Mon-Sun of last week
  | 'previous_month'
  | 'previous_quarter'
  | 'this_week'          // Current week so far
  | 'this_month'
  | 'this_quarter';

type ComparisonType =
  | 'previous_period'    // Compare to period of same length before
  | 'same_period_last_month'
  | 'same_period_last_quarter'
  | 'same_period_last_year'
  | 'none';              // No comparison
```

### Report Widgets

Widgets are the building blocks of reports. Each widget type has specific configuration options.

```typescript
interface ReportWidget {
  id: string // Widget instance ID
  type: WidgetType // Widget type
  config: WidgetConfig // Type-specific configuration
  order: number // Display order
}

type WidgetType =
  | 'executive_summary'
  | 'traffic_changes'
  | 'new_sources'
  | 'channel_performance'
  | 'utm_campaigns'
  | 'goal_performance'
  | 'top_landing_pages'
  | 'top_exit_pages'
  | 'geo_insights'
  | 'device_performance'
  | 'custom_metric_card'
  | 'custom_table'

// Widget-specific configurations
interface ExecutiveSummaryConfig {
  metrics: Array<
    | 'sessions'
    | 'bounce_rate'
    | 'median_duration'
    | 'pageviews'
    | 'pages_per_session'
    | 'goals'
    | 'goal_value'
  >
  showSparklines: boolean
}

interface TrafficChangesConfig {
  showGrowth: boolean // Show top growth sources
  showDecline: boolean // Show top declining sources
  limit: number // Number of sources per section (default: 5)
  minSessions: number // Minimum sessions threshold
}

interface NewSourcesConfig {
  lookbackDays: number // Days to check for "new" (default: 28)
  limit: number // Max sources to show (default: 10)
  minSessions: number // Minimum sessions (default: 5)
}

interface ChannelPerformanceConfig {
  metrics: Array<'sessions' | 'bounce_rate' | 'median_duration' | 'goals' | 'conversion_rate'>
  showComparison: boolean
}

interface GoalPerformanceConfig {
  goals: string[] | 'all' // Specific goal names or all
  showByChannel: boolean // Show breakdown by channel
  showValue: boolean // Show goal values
}

interface GeoInsightsConfig {
  dimension: 'country' | 'region' | 'city'
  limit: number // Top N locations (default: 5)
}

interface CustomMetricCardConfig {
  metric: string // Any valid metric
  label: string // Display label
  showComparison: boolean
  format: 'number' | 'percent' | 'duration' | 'currency'
}

interface CustomTableConfig {
  table: 'sessions' | 'pages' | 'goals'
  dimensions: string[] // Up to 2 dimensions
  metrics: string[] // 1-5 metrics
  limit: number // Row limit
  orderBy: { field: string; direction: 'asc' | 'desc' }
  filters?: Filter[] // Optional filters
}
```

### Report Recipients

```typescript
interface ReportRecipient {
  id: string
  report_id: string
  type: 'member' | 'external'
  user_id?: string // For workspace members
  email?: string // For external recipients
  added_by: string // User ID who added this recipient
  added_at: Date
  unsubscribed: boolean // Recipient opted out
}
```

### Access Control

```typescript
// Who can do what with reports
const reportPermissions = {
  create: ['owner', 'admin', 'editor'], // Create new reports
  view: ['owner', 'admin', 'editor', 'viewer'], // View reports (own + shared)
  edit: ['owner', 'admin', 'editor'], // Edit own reports only
  delete: ['owner', 'admin', 'editor'], // Delete own reports only
  addRecipients: ['owner', 'admin', 'editor'], // Add recipients to own reports
  viewAll: ['owner', 'admin'] // View all workspace reports
}

// Editors can only edit/delete reports they created
// Admins/Owners can edit/delete any report in the workspace
```

## Technical Implementation

### Database Schema

#### New Table: `reports`

```sql
CREATE TABLE staminads_system.reports
(
    id String,
    workspace_id String,
    created_by String,                 -- User ID of creator
    name String,
    description String DEFAULT '',

    -- Widget configuration (JSON array)
    widgets String DEFAULT '[]',       -- JSON: ReportWidget[]

    -- Date range configuration (JSON)
    date_range String DEFAULT '{}',    -- JSON: { preset, comparison }

    -- Email delivery configuration (JSON)
    email_delivery String DEFAULT '{}', -- JSON: { enabled, frequency, dayOfWeek, dayOfMonth, hour }

    -- Metadata
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3),
    last_sent_at Nullable(DateTime64(3)),
    last_viewed_at Nullable(DateTime64(3))
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (workspace_id, id)
```

#### New Table: `report_recipients`

```sql
CREATE TABLE staminads_system.report_recipients
(
    id String,
    report_id String,
    type Enum8('member' = 1, 'external' = 2),
    user_id Nullable(String),          -- For workspace members
    email Nullable(String),            -- For external recipients
    added_by String,                   -- User ID who added this recipient
    added_at DateTime64(3) DEFAULT now64(3),
    unsubscribed UInt8 DEFAULT 0,      -- Recipient opted out
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (report_id, id)
```

#### New Table: `report_snapshots`

Stores generated report data for in-app viewing and email history.

```sql
CREATE TABLE staminads_system.report_snapshots
(
    id String,
    report_id String,
    workspace_id String,

    -- Snapshot metadata
    generated_at DateTime64(3) DEFAULT now64(3),
    period_start Date,                 -- Report period start
    period_end Date,                   -- Report period end

    -- Generated data
    report_data String DEFAULT '{}',   -- JSON snapshot of all widget data

    -- Delivery status
    delivery_type Enum8('manual' = 1, 'scheduled' = 2, 'preview' = 3),
    email_sent UInt8 DEFAULT 0,
    email_sent_at Nullable(DateTime64(3)),
    recipient_count UInt32 DEFAULT 0,

    -- Performance
    generation_time_ms UInt32 DEFAULT 0
)
ENGINE = MergeTree()
ORDER BY (workspace_id, report_id, generated_at)
TTL generated_at + INTERVAL 365 DAY   -- Keep snapshots for 1 year
```


### API Endpoints

#### Report CRUD

```
POST /api/reports.list               -- List reports (own + shared with user)
POST /api/reports.get                -- Get single report by ID
POST /api/reports.create             -- Create new report
POST /api/reports.update             -- Update report configuration
POST /api/reports.delete             -- Delete report
POST /api/reports.duplicate          -- Duplicate an existing report
```

#### Report Execution

```
POST /api/reports.generate           -- Generate report data (for preview or viewing)
POST /api/reports.send               -- Manually send report to recipients
```

#### Report Snapshots (In-App Viewing)

```
POST /api/reports.snapshots.list     -- List snapshots for a report
POST /api/reports.snapshots.get      -- Get snapshot data for viewing
```

#### Recipient Management

```
POST /api/reports.recipients.list    -- List recipients for a report
POST /api/reports.recipients.add     -- Add recipient (member or external)
POST /api/reports.recipients.remove  -- Remove recipient
POST /api/reports.unsubscribe        -- Public: unsubscribe via token
```

#### Widget Catalog

```
GET /api/reports.widgets             -- Get available widget types and configs
```

### Scheduled Job

Using `@nestjs/schedule` with cron expressions:

```typescript
@Injectable()
export class ReportScheduler {
  // Run every hour to check for reports due to be sent
  @Cron('0 * * * *')
  async processScheduledReports() {
    // Get all reports where:
    // - email_delivery.enabled = true
    // - Current time matches schedule in workspace timezone
    const reports = await this.getReportsDueForDelivery()

    for (const report of reports) {
      try {
        const snapshot = await this.reportService.generate(report.id)
        await this.reportService.sendToRecipients(report.id, snapshot.id)
      } catch (error) {
        this.logger.error(`Failed to send report ${report.id}`, error)
      }
    }
  }

  private async getReportsDueForDelivery(): Promise<Report[]> {
    const now = new Date()
    const currentHourUTC = now.getUTCHours()
    const currentDayOfWeek = now.getUTCDay()
    const currentDayOfMonth = now.getUTCDate()

    // Query reports matching current schedule
    // Account for workspace timezone when comparing hours
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
    }
    const previousRange = {
      start: addDays(weekStart, -7),
      end: weekStart
    }

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
    ])

    return { summary, topGrowthSources /* ... */ }
  }
}
```

### Email Template

Built using [MJML](https://mjml.io/) (Mailjet Markup Language) for reliable cross-client email rendering.

**Source file**: `api/src/mail/templates/weekly-report.mjml`
**Compiled output**: `api/src/mail/templates/weekly-report.html`

#### Dependencies

```bash
npm install mjml
```

#### Build Process

MJML templates are compiled to HTML at build time:

```bash
# Add to package.json scripts
"mjml:build": "mjml src/mail/templates/*.mjml -o src/mail/templates/",
"mjml:watch": "mjml --watch src/mail/templates/*.mjml -o src/mail/templates/"
```

The compiled HTML is then processed by Handlebars for variable interpolation at runtime.

#### Template Structure

```mjml
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" color="#333333" />
      <mj-class name="trend-up" color="#16a34a" />
      <mj-class name="trend-down" color="#dc2626" />
      <mj-class name="trend-neutral" color="#6b7280" />
    </mj-attributes>
    <mj-style>
      .metric-value { font-size: 24px; font-weight: 600; } .metric-change { font-size: 12px; }
      .table-header { background-color: #f3f4f6; font-weight: 600; }
    </mj-style>
  </mj-head>

  <mj-body background-color="#f5f5f5">
    <!-- Header -->
    <mj-section background-color="#7763f1" padding="20px">
      <mj-column>
        <mj-text color="#ffffff" font-size="24px" font-weight="600">
          Weekly Traffic Report
        </mj-text>
        <mj-text color="#ffffff" font-size="14px"> {{workspace_name}} · {{report_period}} </mj-text>
      </mj-column>
    </mj-section>

    <!-- Executive Summary -->
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="18px" font-weight="600">Executive Summary</mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#ffffff" padding="0 20px">
      {{#each summary_metrics}}
      <mj-column width="33%">
        <mj-text align="center">
          <span class="metric-value">{{value}}</span><br />
          <span class="metric-change {{trend_class}}">{{change}}</span><br />
          {{label}}
        </mj-text>
      </mj-column>
      {{/each}}
    </mj-section>

    <!-- Traffic Changes Section -->
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="18px" font-weight="600">Top Traffic Changes</mj-text>
        <mj-divider border-color="#e5e7eb" />
      </mj-column>
    </mj-section>

    <!-- Top Growth Sources -->
    <mj-section background-color="#ffffff" padding="0 20px">
      <mj-column>
        <mj-text font-weight="600" color="#16a34a">↑ Top Growth</mj-text>
        <mj-table>
          <tr class="table-header">
            <td>Source</td>
            <td align="right">Sessions</td>
            <td align="right">Change</td>
          </tr>
          {{#each top_growth}}
          <tr>
            <td>{{source}}</td>
            <td align="right">{{sessions}}</td>
            <td align="right" style="color: #16a34a">+{{change}}%</td>
          </tr>
          {{/each}}
        </mj-table>
      </mj-column>
    </mj-section>

    <!-- Top Declining Sources -->
    <mj-section background-color="#ffffff" padding="0 20px 20px">
      <mj-column>
        <mj-text font-weight="600" color="#dc2626">↓ Top Declining</mj-text>
        <mj-table>
          <tr class="table-header">
            <td>Source</td>
            <td align="right">Sessions</td>
            <td align="right">Change</td>
          </tr>
          {{#each top_declining}}
          <tr>
            <td>{{source}}</td>
            <td align="right">{{sessions}}</td>
            <td align="right" style="color: #dc2626">{{change}}%</td>
          </tr>
          {{/each}}
        </mj-table>
      </mj-column>
    </mj-section>

    <!-- New Sources Section -->
    {{#if new_sources.length}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="18px" font-weight="600">🆕 New Traffic Sources</mj-text>
        <mj-text font-size="12px" color="#6b7280">
          First time visitors from these sources this week
        </mj-text>
        <mj-table>
          <tr class="table-header">
            <td>Source</td>
            <td align="right">Sessions</td>
            <td align="right">Bounce Rate</td>
          </tr>
          {{#each new_sources}}
          <tr>
            <td>{{source}}</td>
            <td align="right">{{sessions}}</td>
            <td align="right">{{bounce_rate}}%</td>
          </tr>
          {{/each}}
        </mj-table>
      </mj-column>
    </mj-section>
    {{/if}}

    <!-- Channel Performance -->
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="18px" font-weight="600">Channel Performance</mj-text>
        <mj-table>
          <tr class="table-header">
            <td>Channel</td>
            <td align="right">Sessions</td>
            <td align="right">WoW</td>
            <td align="right">Goals</td>
          </tr>
          {{#each channels}}
          <tr>
            <td>{{name}}</td>
            <td align="right">{{sessions}}</td>
            <td align="right" class="{{wow_class}}">{{wow}}%</td>
            <td align="right">{{goals}}</td>
          </tr>
          {{/each}}
        </mj-table>
      </mj-column>
    </mj-section>

    <!-- Goals Section -->
    {{#if goals.length}}
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-text font-size="18px" font-weight="600">Goal Performance</mj-text>
        <mj-table>
          <tr class="table-header">
            <td>Goal</td>
            <td align="right">Completions</td>
            <td align="right">WoW</td>
            <td align="right">Value</td>
          </tr>
          {{#each goals}}
          <tr>
            <td>{{name}}</td>
            <td align="right">{{completions}}</td>
            <td align="right" class="{{wow_class}}">{{wow}}%</td>
            <td align="right">{{value}}</td>
          </tr>
          {{/each}}
        </mj-table>
      </mj-column>
    </mj-section>
    {{/if}}

    <!-- CTA Button -->
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column>
        <mj-button background-color="#7763f1" href="{{dashboard_url}}">
          View Full Dashboard
        </mj-button>
      </mj-column>
    </mj-section>

    <!-- Footer -->
    <mj-section padding="20px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#6b7280">
          You're receiving this because you're subscribed to weekly reports for {{workspace_name}}.
          <br /><br />
          <a href="{{unsubscribe_url}}" style="color: #6b7280;">Unsubscribe</a> ·
          <a href="{{settings_url}}" style="color: #6b7280;">Email Settings</a>
        </mj-text>
        <mj-text align="center" font-size="11px" color="#9ca3af"> Staminads Analytics </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

#### Design Specifications

| Property        | Value                              |
| --------------- | ---------------------------------- |
| Max width       | 600px                              |
| Primary color   | #7763f1 (Staminads purple)         |
| Success/growth  | #16a34a (green)                    |
| Danger/decline  | #dc2626 (red)                      |
| Neutral         | #6b7280 (gray)                     |
| Background      | #f5f5f5                            |
| Card background | #ffffff                            |
| Font stack      | System fonts (-apple-system, etc.) |
| Base font size  | 14px                               |
| Line height     | 1.5                                |

#### Email Client Compatibility

MJML automatically handles:

- Outlook (Windows, Mac, Web)
- Gmail (Web, iOS, Android)
- Apple Mail (macOS, iOS)
- Yahoo Mail
- Samsung Mail
- Dark mode detection and styling

## UI Components

### Navigation

Add **"Reports"** item to the main topbar navigation (between existing nav items).

```
Dashboard | Analytics | Reports | Goals | Settings
```

**Visibility**: All authenticated users with workspace access (viewer, editor, admin, owner)

### Reports List Page

**Route**: `/reports`

Displays all reports the user has access to:

- Reports created by the user
- Reports where user is a recipient (shared with them)

**Layout**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Reports                                    [+ Create Report]    │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📊 Weekly Traffic Summary                      Created by me │ │
│ │ Last generated: Jan 8, 2025 · Weekly on Mondays at 9:00 AM  │ │
│ │ 3 recipients · 📧 Email enabled                              │ │
│ │                                    [View] [Edit] [Send Now]  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📊 Monthly Campaign Report                     Created by me │ │
│ │ Last generated: Jan 1, 2025 · Monthly on 1st at 8:00 AM     │ │
│ │ 5 recipients · 📧 Email enabled                              │ │
│ │                                    [View] [Edit] [Send Now]  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📊 SEO Performance Weekly                   Shared by @john  │ │
│ │ Last generated: Jan 7, 2025                                  │ │
│ │                                                      [View]  │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Features**:

- Filter: "My Reports" / "Shared with me" / "All"
- Sort: by name, last generated, created date
- Quick actions: View, Edit (own reports only), Send Now, Delete

**Permissions**:

- Viewers: Can only see reports shared with them (as recipient)
- Editors: Can create reports, edit/delete own reports
- Admins/Owners: Can view and manage all workspace reports

### Report Builder Page

**Route**: `/reports/new` (create) or `/reports/:id/edit` (edit)

**Layout**:

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Reports                              [Save] [Preview] │
├─────────────────────────────────────────────────────────────────┤
│ Report Name: [Weekly Traffic Summary___________________________]│
│ Description: [Optional description_____________________________]│
├─────────────────────────────────────────────────────────────────┤
│ DATE RANGE                                                      │
│ ┌─────────────────┐ ┌─────────────────────────────────────────┐ │
│ │ Previous 7 days │ │ Compare to: [Previous period        ▼] │ │
│ │ Previous week   │ │                                         │ │
│ │ Previous 14 days│ │                                         │ │
│ │ Previous 30 days│ │                                         │ │
│ │ Previous month ●│ │                                         │ │
│ └─────────────────┘ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ WIDGETS                                        [+ Add Widget]   │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ ≡ Executive Summary                              [⚙] [×]  │   │
│ │   Metrics: Sessions, Bounce Rate, Median Duration, Goals  │   │
│ └───────────────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ ≡ Traffic Changes                                [⚙] [×]  │   │
│ │   Show: Growth ✓, Decline ✓ · Limit: 5                    │   │
│ └───────────────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ ≡ Channel Performance                            [⚙] [×]  │   │
│ │   Metrics: Sessions, Bounce Rate, Goals                   │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│ [+ Add Widget]                                                  │
├─────────────────────────────────────────────────────────────────┤
│ EMAIL DELIVERY                                                  │
│ [✓] Enable email delivery                                       │
│                                                                 │
│ Frequency: [Weekly          ▼]                                  │
│ Day:       [Monday          ▼]                                  │
│ Time:      [09:00 AM        ▼] (Europe/Paris timezone)          │
├─────────────────────────────────────────────────────────────────┤
│ RECIPIENTS                                     [+ Add Recipient]│
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ 👤 john@company.com (John Doe)              Member    [×] │   │
│ │ 👤 jane@company.com (Jane Smith)            Member    [×] │   │
│ │ 📧 external@partner.com                     External  [×] │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Widget Picker Modal**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Add Widget                                                  [×] │
├─────────────────────────────────────────────────────────────────┤
│ SUMMARY                                                         │
│ ┌─────────────┐ ┌─────────────┐                                 │
│ │ Executive   │ │ Custom      │                                 │
│ │ Summary     │ │ Metric Card │                                 │
│ └─────────────┘ └─────────────┘                                 │
│                                                                 │
│ TRAFFIC                                                         │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 │
│ │ Traffic     │ │ New         │ │ Channel     │                 │
│ │ Changes     │ │ Sources     │ │ Performance │                 │
│ └─────────────┘ └─────────────┘ └─────────────┘                 │
│                                                                 │
│ MARKETING                                                       │
│ ┌─────────────┐ ┌─────────────┐                                 │
│ │ UTM         │ │ Goal        │                                 │
│ │ Campaigns   │ │ Performance │                                 │
│ └─────────────┘ └─────────────┘                                 │
│                                                                 │
│ CONTENT                                                         │
│ ┌─────────────┐ ┌─────────────┐                                 │
│ │ Top Landing │ │ Top Exit    │                                 │
│ │ Pages       │ │ Pages       │                                 │
│ └─────────────┘ └─────────────┘                                 │
│                                                                 │
│ AUDIENCE                                                        │
│ ┌─────────────┐ ┌─────────────┐                                 │
│ │ Geographic  │ │ Device      │                                 │
│ │ Insights    │ │ Performance │                                 │
│ └─────────────┘ └─────────────┘                                 │
│                                                                 │
│ CUSTOM                                                          │
│ ┌─────────────┐                                                 │
│ │ Custom      │                                                 │
│ │ Table       │                                                 │
│ └─────────────┘                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Report View Page

**Route**: `/reports/:id` (latest) or `/reports/:id/snapshots/:snapshotId` (historical)

In-app rendering of report data with same layout as email.

**Layout**:

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Reports                                               │
│                                                                 │
│ Weekly Traffic Summary                                          │
│ Jan 1 - Jan 7, 2025 vs Dec 25 - Dec 31, 2024                   │
│                                                                 │
│ [View History ▼]  [Edit Report]  [Send Now]  [Export PDF]       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─ EXECUTIVE SUMMARY ─────────────────────────────────────────┐ │
│ │                                                             │ │
│ │   Sessions      Bounce Rate    Median Duration    Goals     │ │
│ │   12,456        42.3%          2m 45s             234       │ │
│ │   ↑ +15.2%      ↓ -2.1pp       ↑ +12s             ↑ +8.3%   │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ TRAFFIC CHANGES ───────────────────────────────────────────┐ │
│ │                                                             │ │
│ │ ↑ Top Growth                    ↓ Top Declining             │ │
│ │ ┌────────────────────────────┐  ┌────────────────────────┐  │ │
│ │ │ google.com    +245 (+18%)  │  │ facebook.com  -89 (-12%)│ │
│ │ │ linkedin.com  +156 (+45%)  │  │ twitter.com   -34 (-8%) │ │
│ │ │ partner.com   +89  (+22%)  │  │ bing.com      -23 (-5%) │ │
│ │ └────────────────────────────┘  └────────────────────────┘  │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ CHANNEL PERFORMANCE ───────────────────────────────────────┐ │
│ │                                                             │ │
│ │ Channel          Sessions    WoW %    Bounce    Goals       │ │
│ │ ─────────────────────────────────────────────────────────── │ │
│ │ Organic Search   4,521       +12%     38%       89          │ │
│ │ Direct           3,234       -5%      45%       56          │ │
│ │ Social           2,145       +25%     52%       34          │ │
│ │ Referral         1,234       +8%      41%       28          │ │
│ │ Email            892         +3%      35%       18          │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Snapshot History Dropdown**:

```
┌─────────────────────────┐
│ View History          ▼ │
├─────────────────────────┤
│ ● Jan 8, 2025 (Latest)  │
│   Jan 1, 2025           │
│   Dec 25, 2024          │
│   Dec 18, 2024          │
│   Dec 11, 2024          │
│   ─────────────────     │
│   View all snapshots →  │
└─────────────────────────┘
```

### Add Recipient Modal

```
┌─────────────────────────────────────────────────────────────────┐
│ Add Recipient                                               [×] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ○ Workspace Member                                              │
│   [Search members...________________________]                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ 👤 John Doe (john@company.com)                          │   │
│   │ 👤 Jane Smith (jane@company.com)                        │   │
│   │ 👤 Bob Wilson (bob@company.com)                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│ ○ External Email                                                │
│   [email@example.com____________________________]               │
│                                                                 │
│                                              [Cancel] [Add]     │
└─────────────────────────────────────────────────────────────────┘
```

## Testing Strategy (TDD)

Follow Test-Driven Development: write tests first, then implement to make them pass.

### Unit Tests

Location: `api/src/weekly-reports/*.spec.ts`

#### WeeklyReportService Tests

```typescript
// weekly-report.service.spec.ts

describe('WeeklyReportService', () => {
  describe('generateReport', () => {
    it('should generate executive summary with all metrics', async () => {
      // Mock analytics queries
      // Assert summary contains sessions, bounce_rate, median_duration, etc.
    })

    it('should calculate week-over-week changes correctly', async () => {
      // Current week: 1000 sessions, Previous week: 800 sessions
      // Assert change = +25%
    })

    it('should handle zero previous period gracefully', async () => {
      // Previous week: 0 sessions, Current week: 100 sessions
      // Assert change = +100% or "New"
    })

    it('should identify top growth sources by absolute increase', async () => {
      // Source A: 100 -> 200 (+100)
      // Source B: 50 -> 100 (+50)
      // Assert Source A ranked first
    })

    it('should identify declining sources by absolute decrease', async () => {
      // Source A: 200 -> 100 (-100)
      // Source B: 100 -> 80 (-20)
      // Assert Source A ranked first (most decline)
    })

    it('should detect new traffic sources not seen in past 4 weeks', async () => {
      // Mock: referrer_domain "newsite.com" has 0 sessions in past 28 days
      // Assert it appears in new_sources
    })

    it('should exclude sources below minimum session threshold', async () => {
      // Source with 3 sessions (below threshold of 5)
      // Assert not included in new_sources
    })

    it('should aggregate channel performance with goals', async () => {
      // Mock channel data with goal conversions
      // Assert conversion rate calculated correctly
    })

    it('should handle workspaces with no goals configured', async () => {
      // Mock empty goals table
      // Assert goals section is empty, no errors thrown
    })

    it('should respect workspace timezone for date calculations', async () => {
      // Workspace timezone: America/New_York
      // Assert week boundaries calculated in correct timezone
    })
  })

  describe('getExecutiveSummary', () => {
    it('should return all required metrics', async () => {
      const summary = await service.getExecutiveSummary(workspaceId, range, prevRange)
      expect(summary).toHaveProperty('sessions')
      expect(summary).toHaveProperty('bounce_rate')
      expect(summary).toHaveProperty('median_duration')
      expect(summary).toHaveProperty('pageviews')
      expect(summary).toHaveProperty('pages_per_session')
      expect(summary).toHaveProperty('goals')
      expect(summary).toHaveProperty('goal_value')
    })

    it('should include change percentage for each metric', async () => {
      const summary = await service.getExecutiveSummary(workspaceId, range, prevRange)
      expect(summary.sessions).toHaveProperty('value')
      expect(summary.sessions).toHaveProperty('change')
      expect(summary.sessions).toHaveProperty('trend') // 'up' | 'down' | 'neutral'
    })
  })

  describe('getNewSources', () => {
    it('should look back 28 days for existing sources', async () => {
      // Verify query includes 28-day lookback
    })

    it('should return sources sorted by session count descending', async () => {
      const sources = await service.getNewSources(workspaceId, range)
      for (let i = 1; i < sources.length; i++) {
        expect(sources[i].sessions).toBeLessThanOrEqual(sources[i - 1].sessions)
      }
    })

    it('should limit results to 10 sources', async () => {
      const sources = await service.getNewSources(workspaceId, range)
      expect(sources.length).toBeLessThanOrEqual(10)
    })
  })
})
```

#### WeeklyReportScheduler Tests

```typescript
// weekly-report.scheduler.spec.ts

describe('WeeklyReportScheduler', () => {
  describe('processWeeklyReports', () => {
    it('should only process workspaces matching current hour in their timezone', async () => {
      // Mock: UTC hour is 14:00
      // Workspace A: timezone Europe/London (14:00 local), send_hour: 14 → should process
      // Workspace B: timezone America/New_York (09:00 local), send_hour: 14 → should NOT process
    })

    it('should skip workspaces with reports disabled', async () => {
      // Mock workspace with enabled: false
      // Assert generateAndSendReport not called
    })

    it('should log errors but continue processing other workspaces', async () => {
      // Mock: Workspace A throws error, Workspace B succeeds
      // Assert Workspace B still processed
    })

    it('should record report in logs table after sending', async () => {
      // Assert weekly_report_logs entry created with status: sent
    })

    it('should record failure in logs table on error', async () => {
      // Mock email send failure
      // Assert weekly_report_logs entry with status: failed, error_message populated
    })
  })

  describe('getWorkspacesForCurrentHour', () => {
    it('should handle daylight saving time transitions', async () => {
      // Test with timezone that has DST
    })

    it('should return empty array when no workspaces match', async () => {
      const workspaces = await scheduler.getWorkspacesForCurrentHour()
      expect(Array.isArray(workspaces)).toBe(true)
    })
  })
})
```

#### Subscription Service Tests

```typescript
// weekly-report-subscription.service.spec.ts

describe('WeeklyReportSubscriptionService', () => {
  describe('getRecipients', () => {
    it('should include all workspace members when allMembers is true', async () => {
      // Mock workspace with 3 members
      // Assert all 3 returned
    })

    it('should exclude opted-out members', async () => {
      // Mock: member has optOut: true in preferences
      // Assert member not included
    })

    it('should include additional external emails', async () => {
      // Mock: additionalEmails: ['external@example.com']
      // Assert external email included
    })

    it('should exclude members in excludeMembers list', async () => {
      // Mock: excludeMembers: ['user-id-123']
      // Assert user not included
    })
  })

  describe('subscribe', () => {
    it('should create subscription record', async () => {
      await service.subscribe(workspaceId, email)
      // Assert record created in weekly_report_subscriptions
    })

    it('should reactivate existing inactive subscription', async () => {
      // Mock existing subscription with is_active: 0
      // Assert is_active updated to 1
    })
  })

  describe('unsubscribe', () => {
    it('should deactivate subscription', async () => {
      await service.unsubscribe(workspaceId, email)
      // Assert is_active set to 0
    })

    it('should validate unsubscribe token', async () => {
      // Invalid token should throw UnauthorizedException
    })
  })
})
```

#### Email Template Tests

```typescript
// weekly-report-template.spec.ts

describe('WeeklyReportTemplate', () => {
  describe('render', () => {
    it('should render all sections when data provided', () => {
      const html = template.render(fullReportData)
      expect(html).toContain('Executive Summary')
      expect(html).toContain('Top Traffic Changes')
      expect(html).toContain('Channel Performance')
    })

    it('should hide goals section when no goals data', () => {
      const html = template.render({ ...reportData, goals: [] })
      expect(html).not.toContain('Goal Performance')
    })

    it('should hide new sources section when empty', () => {
      const html = template.render({ ...reportData, new_sources: [] })
      expect(html).not.toContain('New Traffic Sources')
    })

    it('should apply correct CSS class for positive trends', () => {
      const html = template.render(reportDataWithGrowth)
      expect(html).toContain('trend-up')
      expect(html).toContain('color: #16a34a')
    })

    it('should apply correct CSS class for negative trends', () => {
      const html = template.render(reportDataWithDecline)
      expect(html).toContain('trend-down')
      expect(html).toContain('color: #dc2626')
    })

    it('should include unsubscribe link with valid token', () => {
      const html = template.render(reportData)
      expect(html).toMatch(/unsubscribe\?token=[a-zA-Z0-9_-]+/)
    })

    it('should escape HTML in user-provided content', () => {
      const html = template.render({
        ...reportData,
        workspace_name: '<script>alert("xss")</script>'
      })
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })
})
```

### E2E Tests

Location: `api/test/weekly-reports.e2e-spec.ts`

```typescript
// weekly-reports.e2e-spec.ts

describe('Weekly Reports (e2e)', () => {
  let app: INestApplication
  let workspaceId: string
  let authToken: string

  beforeAll(async () => {
    // Setup test app with test database
    // Create test workspace with sample analytics data
    // Generate auth token
  })

  afterAll(async () => {
    // Cleanup test data
    await app.close()
  })

  describe('POST /api/reports.weekly.settings.get', () => {
    it('should return default settings for new workspace', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.get')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceId })
        .expect(200)

      expect(response.body).toMatchObject({
        enabled: false,
        schedule: { dayOfWeek: 1, hour: 9 },
        recipients: { allMembers: true }
      })
    })

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.get')
        .send({ workspace_id: workspaceId })
        .expect(401)
    })

    it('should require workspace membership', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.get')
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({ workspace_id: workspaceId })
        .expect(403)
    })
  })

  describe('POST /api/reports.weekly.settings.update', () => {
    it('should update report settings', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          enabled: true,
          schedule: { dayOfWeek: 1, hour: 10 }
        })
        .expect(200)

      expect(response.body.enabled).toBe(true)
      expect(response.body.schedule.hour).toBe(10)
    })

    it('should require owner or admin permission', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.update')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ workspace_id: workspaceId, enabled: true })
        .expect(403)
    })

    it('should validate schedule dayOfWeek range (0-6)', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          schedule: { dayOfWeek: 7, hour: 9 }
        })
        .expect(400)
    })

    it('should validate schedule hour range (0-23)', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.settings.update')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          schedule: { dayOfWeek: 1, hour: 25 }
        })
        .expect(400)
    })
  })

  describe('POST /api/reports.weekly.preview', () => {
    it('should generate preview report with real data', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/reports.weekly.preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceId })
        .expect(200)

      expect(response.body).toHaveProperty('html')
      expect(response.body).toHaveProperty('data')
      expect(response.body.data).toHaveProperty('summary')
      expect(response.body.data).toHaveProperty('top_growth')
      expect(response.body.data).toHaveProperty('channels')
    })

    it('should use previous week as default date range', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/reports.weekly.preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceId })
        .expect(200)

      // Verify date range is previous Monday to Sunday
      const { period_start, period_end } = response.body.data
      expect(new Date(period_start).getDay()).toBe(1) // Monday
      expect(new Date(period_end).getDay()).toBe(0) // Sunday
    })
  })

  describe('POST /api/reports.weekly.send', () => {
    it('should send report to all recipients', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/reports.weekly.send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceId })
        .expect(200)

      expect(response.body.recipients_count).toBeGreaterThan(0)
      expect(response.body.status).toBe('sent')
    })

    it('should require admin permission', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.send')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ workspace_id: workspaceId })
        .expect(403)
    })

    it('should rate limit to 1 send per hour', async () => {
      // First send succeeds
      await request(app.getHttpServer())
        .post('/api/reports.weekly.send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceId })
        .expect(200)

      // Second send within hour fails
      await request(app.getHttpServer())
        .post('/api/reports.weekly.send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceId })
        .expect(429)
    })

    it('should fail gracefully when SMTP not configured', async () => {
      // Workspace without SMTP
      const response = await request(app.getHttpServer())
        .post('/api/reports.weekly.send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workspace_id: workspaceWithoutSmtp })
        .expect(400)

      expect(response.body.message).toContain('SMTP')
    })
  })

  describe('POST /api/reports.weekly.unsubscribe', () => {
    it('should unsubscribe with valid token', async () => {
      const token = generateUnsubscribeToken(workspaceId, email)

      await request(app.getHttpServer())
        .post('/api/reports.weekly.unsubscribe')
        .send({ token })
        .expect(200)

      // Verify subscription deactivated
    })

    it('should reject invalid token', async () => {
      await request(app.getHttpServer())
        .post('/api/reports.weekly.unsubscribe')
        .send({ token: 'invalid-token' })
        .expect(401)
    })

    it('should reject expired token', async () => {
      const expiredToken = generateUnsubscribeToken(workspaceId, email, -1) // Expired 1 day ago

      await request(app.getHttpServer())
        .post('/api/reports.weekly.unsubscribe')
        .send({ token: expiredToken })
        .expect(401)
    })
  })

  describe('GET /api/reports.weekly.history', () => {
    it('should return list of sent reports', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/reports.weekly.history')
        .query({ workspace_id: workspaceId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(Array.isArray(response.body.reports)).toBe(true)
      if (response.body.reports.length > 0) {
        expect(response.body.reports[0]).toHaveProperty('report_date')
        expect(response.body.reports[0]).toHaveProperty('sent_at')
        expect(response.body.reports[0]).toHaveProperty('recipient_count')
        expect(response.body.reports[0]).toHaveProperty('status')
      }
    })

    it('should paginate results', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/reports.weekly.history')
        .query({ workspace_id: workspaceId, limit: 5, offset: 0 })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.reports.length).toBeLessThanOrEqual(5)
      expect(response.body).toHaveProperty('total')
    })
  })

  describe('Scheduled Report Generation', () => {
    it('should generate and send reports for matching workspaces', async () => {
      // Setup: workspace with reports enabled, schedule matching current time
      // Trigger scheduler manually
      await scheduler.processWeeklyReports()

      // Verify report was sent
      const logs = await getReportLogs(workspaceId)
      expect(logs.length).toBeGreaterThan(0)
      expect(logs[0].status).toBe('sent')
    })

    it('should handle analytics data edge cases', async () => {
      // Test with workspace that has:
      // - No sessions in previous week
      // - No goals
      // - Single traffic source

      await scheduler.processWeeklyReports()

      // Should complete without errors
      const logs = await getReportLogs(workspaceId)
      expect(logs[0].status).toBe('sent')
    })
  })
})
```

### Test Data Fixtures

Location: `api/test/fixtures/weekly-reports.fixtures.ts`

```typescript
export const weeklyReportFixtures = {
  // Workspace with diverse traffic sources
  workspaceWithTraffic: {
    sessions: [
      { referrer_domain: 'google.com', sessions: 500, week: 'current' },
      { referrer_domain: 'google.com', sessions: 400, week: 'previous' },
      { referrer_domain: 'facebook.com', sessions: 200, week: 'current' },
      { referrer_domain: 'facebook.com', sessions: 300, week: 'previous' },
      { referrer_domain: 'newsite.com', sessions: 50, week: 'current' }
      // newsite.com is new (not in previous weeks)
    ],
    goals: [
      { goal_name: 'signup', count: 45, value: 0 },
      { goal_name: 'purchase', count: 12, value: 1200 }
    ]
  },

  // Workspace with no previous data (new workspace)
  newWorkspace: {
    sessions: [{ referrer_domain: 'google.com', sessions: 100, week: 'current' }],
    goals: []
  },

  // Workspace with declining traffic
  decliningWorkspace: {
    sessions: [
      { referrer_domain: 'google.com', sessions: 200, week: 'current' },
      { referrer_domain: 'google.com', sessions: 500, week: 'previous' }
    ],
    goals: []
  }
}
```

### Running Tests

```bash
# Unit tests
npm run test -- --testPathPattern=weekly-report

# Unit tests with coverage
npm run test:cov -- --testPathPattern=weekly-report

# E2E tests
npm run test:e2e -- --testPathPattern=weekly-reports

# All weekly report tests
npm run test -- weekly-report && npm run test:e2e -- weekly-reports
```

## Rollout Plan

### Phase 1: Core Infrastructure

- [ ] Database schema for reports, recipients, snapshots, delivery logs
- [ ] Report CRUD API endpoints
- [ ] Reports nav item in topbar
- [ ] Reports list page (view own reports)
- [ ] Basic report builder UI (name, date range selection)
- [ ] Widget system foundation (executive summary, traffic changes, channel performance)
- [ ] In-app report viewing

### Phase 2: Report Builder & Widgets

- [ ] Complete widget picker with all widget types
- [ ] Widget configuration modals
- [ ] Drag-and-drop widget reordering
- [ ] Report preview functionality
- [ ] Additional widgets: goal performance, UTM campaigns, top pages
- [ ] Duplicate report functionality

### Phase 3: Email Delivery

- [ ] Email delivery configuration UI
- [ ] MJML email template
- [ ] Scheduled job for automatic delivery
- [ ] Recipient management (workspace members)
- [ ] Manual send functionality
- [ ] Delivery logs and status

### Phase 4: Sharing & External Recipients

- [ ] External recipient support
- [ ] Report sharing (viewers can see reports shared with them)
- [ ] Unsubscribe flow with signed tokens
- [ ] Snapshot history and historical report viewing
- [ ] Export to PDF

### Phase 5: Advanced Features (Future)

- [ ] Custom table widget (build your own queries)
- [ ] Custom metric card widget
- [ ] AI-powered anomaly detection
- [ ] Natural language insights
- [ ] Report templates (pre-built configurations)

## Success Metrics

1. **Adoption**: Number of reports created per workspace
2. **Engagement**: Report views (in-app) and email open rates
3. **Retention**: % of reports with email delivery enabled
4. **Collaboration**: Average recipients per report
5. **Usefulness**: User feedback and feature requests

## Security Considerations

1. **Authorization**: Editors can only modify their own reports; admins can manage all
2. **Unsubscribe tokens**: Signed JWT tokens with expiration to prevent enumeration
3. **Data exposure**: Reports only include aggregated metrics, no PII
4. **Rate limiting**: Maximum 1 manual send per report per hour
5. **Recipient limits**: Maximum 50 recipients per report

## References

- [Metrics Watch - Weekly Marketing Reports](https://metricswatch.com/weekly-marketing-reports)
- [GA4 Scheduled Reports](https://support.google.com/analytics/answer/13722168)
- [Bloomreach - Email Marketing Analytics](https://www.bloomreach.com/en/blog/email-marketing-analytics-deep-dive-metrics)
- [DashThis - Web Analytics Report Template](https://dashthis.com/web-analytics-report-template/)
- [Analytify - GA4 Email Reports 2025](https://analytify.io/google-analytics-email-reports/)
