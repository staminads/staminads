import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import mjml from 'mjml';
import { AnalyticsService } from '../../analytics/analytics.service';
import type { DatePreset } from '../../analytics/dto/analytics-query.dto';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { UsersService } from '../../users/users.service';
import {
  Subscription,
  SubscriptionFrequency,
} from '../entities/subscription.entity';
import { deserializeFilters } from '../lib/filter-serializer';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DateRange {
  start: string;
  end: string;
}

export interface MetricSummary {
  key: string;
  label: string;
  current: number;
  previous: number;
  changePercent: number;
  formatted: string;
  formattedPrevious: string;
  trend: 'up' | 'down' | 'neutral';
  trendClass: string;
  trendPrefix: string;
}

export interface DimensionBreakdown {
  dimension: string;
  label: string;
  rows: Array<{
    value: string;
    sessions: number;
    metric: number;
    formattedMetric: string;
  }>;
}

export interface ReportData {
  workspace: {
    id: string;
    name: string;
    timezone: string;
    website?: string;
    logo_url?: string;
  };
  reportName: string;
  dateRange: DateRange;
  dateRangeLabel: string;
  metrics: MetricSummary[];
  dimensions: DimensionBreakdown[];
  dashboardUrl: string;
  unsubscribeUrl: string;
}

// Ordered list of metrics for consistent display
const METRICS_ORDER = [
  'sessions',
  'median_duration',
  'bounce_rate',
  'median_scroll',
] as const;

const METRIC_LABELS: Record<string, string> = {
  sessions: 'Sessions',
  median_duration: 'TimeScore',
  bounce_rate: 'Bounce Rate',
  median_scroll: 'Scroll Depth',
};

/**
 * Calculate heat map color based on median duration value
 * Two-tone gradient with reference as pivot:
 * - Below reference: white → green
 * - Above reference: green → cyan (to spot exceptional sources)
 */
function getHeatMapColor(
  value: number,
  bestValue: number,
  referenceValue?: number,
): string {
  if (!bestValue || value <= 0) return '#f5f5f5';

  const reference = referenceValue ?? bestValue;
  const effectiveMax = Math.max(bestValue, reference);

  if (value <= reference) {
    // Below/at reference: white → green
    const ratio = value / reference;
    const lightness = 100 - ratio * 40; // 100% → 60%
    return `hsl(142, 70%, ${lightness}%)`;
  } else {
    // Above reference: green → cyan
    const headroom = effectiveMax - reference;
    if (headroom <= 0) {
      return `hsl(180, 70%, 50%)`;
    }
    const aboveRatio = Math.min((value - reference) / headroom, 1);
    const hue = 142 + aboveRatio * 38; // 142 → 180 (cyan)
    const lightness = 60 - aboveRatio * 10; // 60% → 50%
    return `hsl(${hue}, 70%, ${lightness}%)`;
  }
}

const DIMENSION_LABELS: Record<string, string> = {
  landing_path: 'Landing Pages',
  exit_path: 'Exit Pages',
  referrer_domain: 'Referrers',
  channel: 'Channels',
  channel_group: 'Channel Groups',
  utm_campaign: 'Campaigns',
  utm_source: 'UTM Sources',
  utm_medium: 'UTM Mediums',
  utm_content: 'UTM Contents',
  utm_term: 'UTM Terms',
  country: 'Countries',
  device: 'Devices',
  browser: 'Browsers',
  os: 'Operating Systems',
  goal_name: 'Goals',
};

@Injectable()
export class ReportGeneratorService {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly workspacesService: WorkspacesService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getPresetForFrequency(frequency: SubscriptionFrequency): DatePreset {
    switch (frequency) {
      case 'daily':
        return 'yesterday';
      case 'weekly':
        return 'previous_7_days';
      case 'monthly':
        return 'previous_30_days';
      default:
        return 'yesterday';
    }
  }

  async generate(subscription: Subscription): Promise<ReportData> {
    const workspace = await this.workspacesService.get(
      subscription.workspace_id,
    );

    // Map frequency to date preset (same as dashboard)
    const preset = this.getPresetForFrequency(subscription.frequency);
    const filters = deserializeFilters(subscription.filters);
    const appUrl =
      this.configService.get<string>('APP_URL') || 'http://localhost:5173';

    // Query metrics summary using preset (same as dashboard)
    const queryParams = {
      workspace_id: subscription.workspace_id,
      metrics: subscription.metrics,
      filters,
      dateRange: { preset },
      compareDateRange: { preset },
      timezone: workspace.timezone,
    };
    const metricsResponse = await this.analyticsService.query(queryParams);

    // Get resolved date range from response meta for display
    const dateRange = metricsResponse.meta.dateRange;

    // Parse metrics from response
    const metricsData = metricsResponse.data as {
      current: Record<string, unknown>[];
      previous: Record<string, unknown>[];
    };
    const currentMetrics = metricsData.current[0] || {};
    const previousMetrics = metricsData.previous[0] || {};

    // Use fixed order for consistent display
    const metrics: MetricSummary[] = METRICS_ORDER.map((key) => {
      const current = Number(currentMetrics[key] || 0);
      const previous = Number(previousMetrics[key] || 0);
      const changePercent =
        previous !== 0 ? ((current - previous) / previous) * 100 : 0;

      const trend =
        changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';
      return {
        key,
        label: METRIC_LABELS[key] || key,
        current,
        previous,
        changePercent: Math.round(changePercent * 10) / 10,
        formatted: this.formatMetric(key, current),
        formattedPrevious: this.formatMetric(key, previous),
        trend,
        trendClass:
          trend === 'up'
            ? 'positive'
            : trend === 'down'
              ? 'negative'
              : 'neutral',
        trendPrefix: trend === 'up' ? '+' : '',
      };
    });

    // Query dimension breakdowns
    const dimensions: DimensionBreakdown[] = [];
    for (const dimension of subscription.dimensions) {
      const isGoals = dimension === 'goal_name';
      const dimensionMetrics = isGoals
        ? ['goals', 'sum_goal_value']
        : ['sessions', 'median_duration'];

      const dimensionResponse = await this.analyticsService.query({
        workspace_id: subscription.workspace_id,
        metrics: dimensionMetrics,
        dimensions: [dimension],
        filters,
        dateRange: { preset },
        timezone: workspace.timezone,
        limit: subscription.limit || 10,
        order: { [dimensionMetrics[0]]: 'desc' },
        ...(isGoals && { table: 'goals' }),
      });

      const rows = (dimensionResponse.data as Record<string, unknown>[])
        .filter((row) => {
          // Filter out rows with empty dimension values or zero sessions
          const dimValue = row[dimension];
          const sessions = Number(row[dimensionMetrics[0]] || 0);
          return dimValue && String(dimValue).trim() !== '' && sessions > 0;
        })
        .map((row) => ({
          value: String(row[dimension]),
          sessions: Number(row[dimensionMetrics[0]] || 0),
          metric: Number(row[dimensionMetrics[1]] || 0),
          formattedMetric: this.formatMetric(
            dimensionMetrics[1],
            Number(row[dimensionMetrics[1]] || 0),
          ),
        }));

      dimensions.push({
        dimension,
        label: DIMENSION_LABELS[dimension] || dimension,
        rows,
      });
    }

    const unsubscribeToken = this.generateUnsubscribeToken(subscription.id);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        timezone: workspace.timezone,
        website: workspace.website,
        logo_url: workspace.logo_url,
      },
      reportName: subscription.name,
      dateRange,
      dateRangeLabel: this.formatDateRangeLabel(
        dateRange,
        subscription.frequency,
        workspace.timezone,
      ),
      metrics,
      dimensions,
      dashboardUrl: `${appUrl}/workspaces/${workspace.id}`,
      unsubscribeUrl: `${appUrl}/unsubscribe?token=${unsubscribeToken}`,
    };
  }

  renderEmail(reportData: ReportData, subscription: Subscription): string {
    const mjmlSource = this.buildMjml(reportData, subscription.name);
    const { html, errors } = mjml(mjmlSource, { validationLevel: 'soft' });

    if (errors.length > 0) {
      console.warn('MJML compilation warnings:', errors);
    }

    return html;
  }

  generateUnsubscribeToken(subscriptionId: string): string {
    return this.jwtService.sign(
      { sub: subscriptionId, action: 'unsubscribe' },
      { expiresIn: '30d' },
    );
  }

  private formatMetric(key: string, value: number): string {
    if (key === 'median_duration') {
      // Value is already in seconds (SQL divides by 1000)
      const seconds = Math.round(value);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }

    if (key === 'bounce_rate' || key === 'median_scroll') {
      return `${value.toFixed(1)}%`;
    }

    return value.toLocaleString();
  }

  private formatDateRangeLabel(
    dateRange: DateRange,
    frequency: SubscriptionFrequency,
    timezone: string,
  ): string {
    const start = dayjs(dateRange.start).tz(timezone);
    const end = dayjs(dateRange.end).tz(timezone);

    if (frequency === 'daily') {
      return start.format('MMM D, YYYY');
    }

    return `${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`;
  }

  private buildMjml(data: ReportData, subscriptionName: string): string {
    const metricsHeaders = data.metrics.map((m) => `<th>${m.label}</th>`).join('\n                  ');
    const metricsValues = data.metrics.map((m) => `<td>${m.formatted}</td>`).join('\n                  ');
    const metricsTrends = data.metrics
      .map((m) => `<td class="${m.trendClass}">${m.trendPrefix}${m.changePercent}%</td>`)
      .join('\n                  ');

    // Build workspace icon - use logo if available, otherwise show initial
    const workspaceIcon = data.workspace.logo_url
      ? `<img src="${data.workspace.logo_url}" alt="" width="32" height="32" style="width: 32px; height: 32px; border-radius: 4px; display: block;" />`
      : `<div style="width: 32px; height: 32px; background-color: #7763f1; border-radius: 4px; text-align: center; line-height: 32px; color: white; font-weight: bold; font-size: 14px; font-family: Arial, sans-serif;">${data.workspace.name.charAt(0).toUpperCase()}</div>`;

    const dimensionSections = data.dimensions
      .map((dim) => {
        // Calculate max metric value for heat map coloring
        const maxMetric = Math.max(...dim.rows.map((r) => r.metric), 0);

        return `
    <mj-wrapper padding-top="8px">
      <mj-section background-color="#ffffff" padding-top="10px" padding-bottom="0px">
        <mj-column>
          <mj-text font-size="13px" font-weight="bold">
            ${dim.label}
          </mj-text>
        </mj-column>
      </mj-section>
      <mj-section background-color="#ffffff" padding-top="8px" padding-bottom="12px" padding-left="12px" padding-right="12px">
        <mj-column>
          <mj-raw>
            <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px;">
              <thead>
                <tr>
                  <th style="padding: 6px 4px; text-align: left; border-bottom: 2px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.3;">Name</th>
                  <th style="padding: 6px 4px; text-align: right; border-bottom: 2px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.3;">Sessions</th>
                  <th style="padding: 6px 4px; text-align: right; border-bottom: 2px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.3;">TimeScore</th>
                </tr>
              </thead>
              <tbody>
                ${dim.rows
                  .map((row) => {
                    const heatColor = getHeatMapColor(row.metric, maxMetric);
                    return `<tr>
                  <td style="padding: 6px 4px; border-bottom: 1px solid #f3f4f6; line-height: 1.3; color: #333333;">${row.value}</td>
                  <td style="padding: 6px 4px; border-bottom: 1px solid #f3f4f6; line-height: 1.3; text-align: right; color: #333333;">${row.sessions}</td>
                  <td style="padding: 6px 4px; border-bottom: 1px solid #f3f4f6; line-height: 1.3; text-align: right; color: #333333;"><span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background-color: ${heatColor}; margin-right: 6px; vertical-align: middle;"></span>${row.formattedMetric}</td>
                </tr>`;
                  })
                  .join('\n                ')}
              </tbody>
            </table>
          </mj-raw>
        </mj-column>
      </mj-section>
    </mj-wrapper>`;
      })
      .join('');

    return `<mjml>
  <mj-head>
    <mj-title>${subscriptionName} - ${data.workspace.name}</mj-title>
    <mj-preview>${subscriptionName} for ${data.dateRangeLabel}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="12px" color="#333333" line-height="1.4" />
      <mj-section padding="0px" />
    </mj-attributes>
    <mj-style>
      .positive { color: #10b981; }
      .negative { color: #ef4444; }
      .neutral { color: #6b7280; }
      .kpi-table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; }
      .kpi-table th { padding: 0 4px 4px 4px; text-align: center; font-size: 11px; color: #6b7280; font-weight: normal; }
      .kpi-table td { padding: 2px 4px; text-align: center; }
      .kpi-table .values td { font-size: 18px; font-weight: bold; }
      .kpi-table .trends td { font-size: 11px; }
    </mj-style>
  </mj-head>

  <mj-body background-color="#f3f6fc">
    <!-- Header: Workspace Info + Staminads Logo -->
    <mj-section padding-top="16px" padding-bottom="0px" padding-left="12px" padding-right="12px">
      <mj-column width="70%" vertical-align="middle">
        <mj-table padding="0">
          <tr>
            <td style="width: 36px; vertical-align: middle; padding: 0;">
              ${workspaceIcon}
            </td>
            <td style="vertical-align: middle; padding: 0 0 0 8px;">
              <div style="font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: #333333; line-height: 1.45;">${data.workspace.name}</div>
              ${data.workspace.website ? `<div style="font-family: Arial, sans-serif; font-size: 10px; color: #9ca3af; line-height: 1;">${data.workspace.website.replace(/^https?:\/\//, '')}</div>` : ''}
            </td>
          </tr>
        </mj-table>
      </mj-column>
      <mj-column width="30%" vertical-align="middle">
        <mj-image src="https://www.staminads.com/favicon.svg" alt="Staminads" width="32px" align="right" padding="0" />
      </mj-column>
    </mj-section>

    <!-- Header: Report Title & Date Range -->
    <mj-section padding-top="12px" padding-bottom="12px" padding-left="12px" padding-right="12px">
      <mj-column width="50%" vertical-align="middle">
        <mj-text font-size="15px" font-weight="bold" color="#333333" padding="0">
          ${subscriptionName}
        </mj-text>
      </mj-column>
      <mj-column width="50%" vertical-align="middle">
        <mj-text font-size="11px" color="#6b7280" align="right" padding="0">
          ${data.dateRangeLabel} · ${data.workspace.timezone}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-wrapper padding-top="8px">
      <mj-section background-color="#ffffff" padding-top="12px" padding-bottom="12px" padding-left="12px" padding-right="12px">
        <mj-column>
          <mj-raw>
            <table class="kpi-table">
              <thead>
                <tr>
                  ${metricsHeaders}
                </tr>
              </thead>
              <tbody>
                <tr class="values">
                  ${metricsValues}
                </tr>
                <tr class="trends">
                  ${metricsTrends}
                </tr>
              </tbody>
            </table>
          </mj-raw>
        </mj-column>
      </mj-section>
    </mj-wrapper>
${dimensionSections}

    <mj-section padding-top="8px" padding-bottom="8px">
      <mj-column>
        <mj-button background-color="#7763f1" color="#ffffff" font-size="12px" font-weight="bold" border-radius="4px" padding-top="8px" padding-bottom="8px" padding-left="16px" padding-right="16px" href="${data.dashboardUrl}">
          View Dashboard
        </mj-button>
      </mj-column>
    </mj-section>

    <mj-section padding-top="8px" padding-bottom="12px">
      <mj-column>
        <mj-text align="center" font-size="11px" color="#9ca3af">
          <a href="${data.unsubscribeUrl}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe</a> from this report
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
  }
}
