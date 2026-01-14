import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
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
import { AnalyticsTable } from './constants/tables';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { isoToClickHouseDateTime } from '../common/utils/datetime.util';

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
  private readonly CACHE_TTL_HISTORICAL = 5 * 60 * 1000; // 5 min for historical
  private readonly CACHE_TTL_LIVE = 60 * 1000; // 1 min for queries including today
  private pendingQueries = new Map<string, Promise<AnalyticsResponse>>();
  private workspaceCacheKeys = new Map<string, Set<string>>();

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly workspacesService: WorkspacesService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async query(dto: AnalyticsQueryDto): Promise<AnalyticsResponse> {
    // Validate workspace exists and get timezone
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const tz = dto.timezone || workspace.timezone || 'UTC';

    // Resolve date range from preset for cache key
    const resolvedDates = dto.dateRange.preset
      ? resolveDatePreset(dto.dateRange.preset, tz)
      : { start: dto.dateRange.start!, end: dto.dateRange.end! };

    const cacheKey = this.generateCacheKey(dto, resolvedDates, tz);

    // Check cache first
    const cached = await this.cacheManager.get<AnalyticsResponse>(cacheKey);
    if (cached) return cached;

    // Deduplicate concurrent identical requests
    if (this.pendingQueries.has(cacheKey)) {
      return this.pendingQueries.get(cacheKey)!;
    }

    // Execute query and cache result
    const queryPromise = this.executeQueryInternal(dto, workspace, tz)
      .then(async (result) => {
        const ttl = this.getTTL(resolvedDates, tz);
        await this.cacheManager.set(cacheKey, result, ttl);
        return result;
      })
      .finally(() => {
        this.pendingQueries.delete(cacheKey);
      });

    this.pendingQueries.set(cacheKey, queryPromise);
    return queryPromise;
  }

  private async executeQueryInternal(
    dto: AnalyticsQueryDto,
    workspace: Workspace,
    tz: string,
  ): Promise<AnalyticsResponse> {
    // Get table (default to sessions)
    const table: AnalyticsTable = dto.table || 'sessions';

    // Validate metrics
    for (const metric of dto.metrics) {
      if (!METRICS[metric]) {
        throw new BadRequestException(`Unknown metric: ${metric}`);
      }
      if (!METRICS[metric].tables.includes(table)) {
        throw new BadRequestException(
          `Metric '${metric}' is not available for table '${table}'`,
        );
      }
    }

    // Validate dimensions
    for (const dimension of dto.dimensions || []) {
      if (!DIMENSIONS[dimension]) {
        throw new BadRequestException(`Unknown dimension: ${dimension}`);
      }
      if (!DIMENSIONS[dimension].tables.includes(table)) {
        throw new BadRequestException(
          `Dimension '${dimension}' is not available for table '${table}'`,
        );
      }
    }

    // Validate metricFilters
    for (const mf of dto.metricFilters || []) {
      if (!METRICS[mf.metric]) {
        throw new BadRequestException(`Unknown metric: ${mf.metric}`);
      }
      if (!METRICS[mf.metric].tables.includes(table)) {
        throw new BadRequestException(
          `Metric '${mf.metric}' is not available for table '${table}'`,
        );
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
      resolvedDateRange.start = isoToClickHouseDateTime(
        resolvedDateRange.start,
      )!;
    }
    if (resolvedDateRange.end?.includes('T')) {
      resolvedDateRange.end = isoToClickHouseDateTime(resolvedDateRange.end)!;
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
        tz,
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
      compareDateRange.start = isoToClickHouseDateTime(compareDateRange.start)!;
    }
    if (compareDateRange.end?.includes('T')) {
      compareDateRange.end = isoToClickHouseDateTime(compareDateRange.end)!;
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
          tz,
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
          tz,
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

  getAvailableMetrics(table?: AnalyticsTable) {
    const all = Object.values(METRICS);
    return table ? all.filter((m) => m.tables.includes(table)) : all;
  }

  getAvailableDimensions(table?: AnalyticsTable) {
    if (!table) return DIMENSIONS;
    return Object.fromEntries(
      Object.entries(DIMENSIONS).filter(([, d]) => d.tables.includes(table)),
    );
  }

  async extremes(dto: ExtremesQueryDto): Promise<ExtremesResponse> {
    // Validate workspace exists and get timezone
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const tz = dto.timezone || workspace.timezone || 'UTC';

    // Get table (default to sessions)
    const table: AnalyticsTable = dto.table || 'sessions';

    // Validate metric
    if (!METRICS[dto.metric]) {
      throw new BadRequestException(`Unknown metric: ${dto.metric}`);
    }
    if (!METRICS[dto.metric].tables.includes(table)) {
      throw new BadRequestException(
        `Metric '${dto.metric}' is not available for table '${table}'`,
      );
    }

    // Validate dimensions
    for (const dim of dto.groupBy) {
      if (!DIMENSIONS[dim]) {
        throw new BadRequestException(`Unknown dimension: ${dim}`);
      }
      if (!DIMENSIONS[dim].tables.includes(table)) {
        throw new BadRequestException(
          `Dimension '${dim}' is not available for table '${table}'`,
        );
      }
    }

    // Validate metricFilters
    for (const mf of dto.metricFilters || []) {
      if (!METRICS[mf.metric]) {
        throw new BadRequestException(`Unknown metric: ${mf.metric}`);
      }
      if (!METRICS[mf.metric].tables.includes(table)) {
        throw new BadRequestException(
          `Metric '${mf.metric}' is not available for table '${table}'`,
        );
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
      resolvedDateRange.start = isoToClickHouseDateTime(
        resolvedDateRange.start,
      )!;
    }
    if (resolvedDateRange.end?.includes('T')) {
      resolvedDateRange.end = isoToClickHouseDateTime(resolvedDateRange.end)!;
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

  /**
   * Get cache TTL based on whether the date range includes today.
   * Live data (includes today) gets 1 min TTL, historical gets 5 min.
   */
  private getTTL(dates: { start: string; end: string }, tz: string): number {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    // Handle both ISO format (2025-01-05T...) and ClickHouse format (2025-01-05 ...)
    const endDate = dates.end.split(' ')[0].split('T')[0];
    return endDate >= today ? this.CACHE_TTL_LIVE : this.CACHE_TTL_HISTORICAL;
  }

  /**
   * Generate a cache key from query parameters.
   * Key is workspace-scoped and includes all query-affecting parameters.
   */
  private generateCacheKey(
    dto: AnalyticsQueryDto,
    dates: { start: string; end: string },
    tz: string,
  ): string {
    const parts = [
      dto.workspace_id,
      dto.table || 'sessions',
      [...dto.metrics].sort().join(','),
      [...(dto.dimensions || [])].sort().join(','),
      [...(dto.totalsGroupBy || [])].sort().join(','),
      dates.start,
      dates.end,
      dto.dateRange.granularity || '',
      tz,
      dto.limit || 1000,
      JSON.stringify(dto.filters || []),
      JSON.stringify(dto.metricFilters || []),
      JSON.stringify(dto.order || {}),
      dto.compareDateRange ? JSON.stringify(dto.compareDateRange) : '',
      dto.havingMinSessions || 0,
    ];
    const hash = crypto
      .createHash('sha256')
      .update(parts.join('|'))
      .digest('hex')
      .slice(0, 16);
    const key = `analytics:${dto.workspace_id}:${hash}`;

    // Track key for invalidation
    if (!this.workspaceCacheKeys.has(dto.workspace_id)) {
      this.workspaceCacheKeys.set(dto.workspace_id, new Set());
    }
    this.workspaceCacheKeys.get(dto.workspace_id)!.add(key);

    return key;
  }

  /**
   * Handle backfill completion event.
   * Clears all cached queries for the workspace.
   */
  @OnEvent('backfill.completed')
  async handleBackfillCompleted(payload: { workspaceId: string }) {
    const keys = this.workspaceCacheKeys.get(payload.workspaceId);
    if (keys) {
      await Promise.all([...keys].map((k) => this.cacheManager.del(k)));
      this.workspaceCacheKeys.delete(payload.workspaceId);
      console.log(
        `Cleared ${keys.size} cached analytics queries for workspace ${payload.workspaceId}`,
      );
    }
  }
}
