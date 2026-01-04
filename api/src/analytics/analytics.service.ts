import { Injectable, BadRequestException } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { ExtremesQueryDto, ExtremesResponse } from './dto/extremes-query.dto';
import { buildAnalyticsQuery, buildExtremesQuery } from './lib/query-builder';
import {
  resolveDatePreset,
  fillGaps,
  shiftPresetToPreviousPeriod,
} from './lib/date-utils';
import { METRICS, MetricContext } from './constants/metrics';
import { DIMENSIONS } from './constants/dimensions';

// Convert ISO date string to ClickHouse DateTime64 format
function toClickHouseDateTime(isoDate: string): string {
  // ClickHouse expects: 2025-12-01 00:00:00.000
  // ISO format is: 2025-12-01T00:00:00.000Z
  return isoDate.replace('T', ' ').replace('Z', '');
}

const GRANULARITY_COLUMNS: Record<string, string> = {
  hour: 'date_hour',
  day: 'date_day',
  week: 'date_week',
  month: 'date_month',
  year: 'date_year',
};

export interface AnalyticsResponse {
  data:
    | Record<string, unknown>[]
    | {
        current: Record<string, unknown>[];
        previous: Record<string, unknown>[];
      };
  meta: {
    metrics: string[];
    dimensions: string[];
    granularity?: string;
    dateRange: { start: string; end: string };
    compareDateRange?: { start: string; end: string };
    total_rows: number;
  };
  query: {
    sql: string;
    params: Record<string, unknown>;
  };
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async query(dto: AnalyticsQueryDto): Promise<AnalyticsResponse> {
    // Validate workspace exists and get timezone
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const tz = dto.timezone || workspace.timezone || 'UTC';

    // Validate metrics
    for (const metric of dto.metrics) {
      if (!METRICS[metric]) {
        throw new BadRequestException(`Unknown metric: ${metric}`);
      }
    }

    // Validate dimensions
    for (const dimension of dto.dimensions || []) {
      if (!DIMENSIONS[dimension]) {
        throw new BadRequestException(`Unknown dimension: ${dimension}`);
      }
    }

    // Resolve date range from preset if needed
    const resolvedDateRange = { ...dto.dateRange };
    if (dto.dateRange.preset) {
      const resolved = resolveDatePreset(dto.dateRange.preset, tz);
      resolvedDateRange.start = resolved.start;
      resolvedDateRange.end = resolved.end;
    }

    // Convert ISO dates to ClickHouse format if they contain 'T'
    if (resolvedDateRange.start?.includes('T')) {
      resolvedDateRange.start = toClickHouseDateTime(resolvedDateRange.start);
    }
    if (resolvedDateRange.end?.includes('T')) {
      resolvedDateRange.end = toClickHouseDateTime(resolvedDateRange.end);
    }

    // Build query with resolved dates
    const queryDto = {
      ...dto,
      dateRange: resolvedDateRange,
    };

    // Build metric context from workspace settings
    const metricContext: MetricContext = {
      bounce_threshold: workspace.settings.bounce_threshold ?? 10,
    };

    // Handle comparison period
    if (dto.compareDateRange) {
      return this.queryWithComparison(queryDto, tz, metricContext);
    }

    // Build and execute query (pass timezone for granularity grouping)
    const { sql, params } = buildAnalyticsQuery(queryDto, tz, metricContext);
    // Query the workspace-specific database
    let data = await this.clickhouse.queryWorkspace<Record<string, unknown>>(
      dto.workspace_id,
      sql,
      params,
    );

    // Fill gaps if granularity is set (pass dimensions for per-dimension gap filling)
    const granularity = dto.dateRange.granularity;
    if (granularity && resolvedDateRange.start && resolvedDateRange.end) {
      const dateColumn = GRANULARITY_COLUMNS[granularity];
      data = fillGaps(
        data,
        granularity,
        dateColumn,
        resolvedDateRange.start,
        resolvedDateRange.end,
        dto.metrics,
        dto.dimensions || [],
      );
    }

    return {
      data,
      meta: {
        metrics: dto.metrics,
        dimensions: dto.dimensions || [],
        granularity: dto.dateRange.granularity,
        dateRange: {
          start: resolvedDateRange.start!,
          end: resolvedDateRange.end!,
        },
        total_rows: data.length,
      },
      query: { sql, params },
    };
  }

  private async queryWithComparison(
    dto: AnalyticsQueryDto & { dateRange: { start?: string; end?: string } },
    tz: string,
    metricContext: MetricContext,
  ): Promise<AnalyticsResponse> {
    // Resolve comparison date range
    const compareDateRange = { ...dto.compareDateRange! };

    // Auto-shift: if same preset used for both, shift comparison to previous period
    if (
      dto.compareDateRange!.preset &&
      dto.dateRange.preset &&
      dto.compareDateRange!.preset === dto.dateRange.preset
    ) {
      const shifted = shiftPresetToPreviousPeriod(
        dto.compareDateRange!.preset,
        tz,
      );
      compareDateRange.start = shifted.start;
      compareDateRange.end = shifted.end;
    } else if (dto.compareDateRange!.preset) {
      const resolved = resolveDatePreset(dto.compareDateRange!.preset, tz);
      compareDateRange.start = resolved.start;
      compareDateRange.end = resolved.end;
    }

    // Convert ISO dates to ClickHouse format if they contain 'T'
    if (compareDateRange.start?.includes('T')) {
      compareDateRange.start = toClickHouseDateTime(compareDateRange.start);
    }
    if (compareDateRange.end?.includes('T')) {
      compareDateRange.end = toClickHouseDateTime(compareDateRange.end);
    }

    // Build current period query (pass timezone for granularity grouping)
    const { sql: currentSql, params: currentParams } = buildAnalyticsQuery(
      dto,
      tz,
      metricContext,
    );

    // Build previous period query
    const previousDto = {
      ...dto,
      dateRange: {
        ...compareDateRange,
        granularity: dto.dateRange.granularity,
      },
    };
    const { sql: previousSql, params: previousParams } = buildAnalyticsQuery(
      previousDto,
      tz,
      metricContext,
    );

    // Execute both queries against workspace database
    const [currentData, previousData] = await Promise.all([
      this.clickhouse.queryWorkspace<Record<string, unknown>>(
        dto.workspace_id,
        currentSql,
        currentParams,
      ),
      this.clickhouse.queryWorkspace<Record<string, unknown>>(
        dto.workspace_id,
        previousSql,
        previousParams,
      ),
    ]);

    // Fill gaps for both if granularity is set (pass dimensions for per-dimension gap filling)
    const granularity = dto.dateRange.granularity;
    let filledCurrent = currentData;
    let filledPrevious = previousData;

    if (granularity) {
      const dateColumn = GRANULARITY_COLUMNS[granularity];
      if (dto.dateRange.start && dto.dateRange.end) {
        filledCurrent = fillGaps(
          currentData,
          granularity,
          dateColumn,
          dto.dateRange.start,
          dto.dateRange.end,
          dto.metrics,
          dto.dimensions || [],
        );
      }
      if (compareDateRange.start && compareDateRange.end) {
        filledPrevious = fillGaps(
          previousData,
          granularity,
          dateColumn,
          compareDateRange.start,
          compareDateRange.end,
          dto.metrics,
          dto.dimensions || [],
        );
      }
    }

    return {
      data: {
        current: filledCurrent,
        previous: filledPrevious,
      },
      meta: {
        metrics: dto.metrics,
        dimensions: dto.dimensions || [],
        granularity: dto.dateRange.granularity,
        dateRange: { start: dto.dateRange.start!, end: dto.dateRange.end! },
        compareDateRange: {
          start: compareDateRange.start!,
          end: compareDateRange.end!,
        },
        total_rows: filledCurrent.length + filledPrevious.length,
      },
      query: { sql: currentSql, params: currentParams },
    };
  }

  getAvailableMetrics() {
    return Object.values(METRICS);
  }

  getAvailableDimensions() {
    return DIMENSIONS;
  }

  async extremes(dto: ExtremesQueryDto): Promise<ExtremesResponse> {
    // Validate workspace exists and get timezone
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const tz = dto.timezone || workspace.timezone || 'UTC';

    // Validate metric
    if (!METRICS[dto.metric]) {
      throw new BadRequestException(`Unknown metric: ${dto.metric}`);
    }

    // Validate dimensions
    for (const dim of dto.groupBy) {
      if (!DIMENSIONS[dim]) {
        throw new BadRequestException(`Unknown dimension: ${dim}`);
      }
    }

    // Resolve date range from preset if needed
    const resolvedDateRange = { ...dto.dateRange };
    if (dto.dateRange.preset) {
      const resolved = resolveDatePreset(dto.dateRange.preset, tz);
      resolvedDateRange.start = resolved.start;
      resolvedDateRange.end = resolved.end;
    }

    // Convert ISO dates to ClickHouse format
    if (resolvedDateRange.start?.includes('T')) {
      resolvedDateRange.start = toClickHouseDateTime(resolvedDateRange.start);
    }
    if (resolvedDateRange.end?.includes('T')) {
      resolvedDateRange.end = toClickHouseDateTime(resolvedDateRange.end);
    }

    // Build metric context from workspace settings
    const metricContext: MetricContext = {
      bounce_threshold: workspace.settings.bounce_threshold ?? 10,
    };

    // Build query with resolved dates
    const queryDto = { ...dto, dateRange: resolvedDateRange };
    const { sql, params } = buildExtremesQuery(queryDto, metricContext);

    // Execute query - result includes dimension columns for max row
    const result = await this.clickhouse.queryWorkspace<
      Record<string, unknown>
    >(dto.workspace_id, sql, params);

    const row = result[0] || {};

    // Extract dimension values from the result (all columns except min/max)
    const maxDimensionValues: Record<string, string | number | null> = {};
    for (const dim of dto.groupBy) {
      const dimDef = DIMENSIONS[dim];
      if (dimDef && row[dimDef.column] !== undefined) {
        maxDimensionValues[dim] = row[dimDef.column] as string | number | null;
      }
    }

    return {
      min: (row.min as number) ?? null,
      max: (row.max as number) ?? null,
      maxDimensionValues:
        Object.keys(maxDimensionValues).length > 0
          ? maxDimensionValues
          : undefined,
      meta: {
        metric: dto.metric,
        groupBy: dto.groupBy,
        dateRange: {
          start: resolvedDateRange.start!,
          end: resolvedDateRange.end!,
        },
      },
    };
  }
}
