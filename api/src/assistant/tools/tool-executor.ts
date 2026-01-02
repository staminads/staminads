import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from '../../analytics/analytics.service';
import { DIMENSIONS } from '../../analytics/constants/dimensions';
import { METRICS } from '../../analytics/constants/metrics';
import { DATE_PRESETS, DatePreset } from '../../analytics/dto/analytics-query.dto';
import { ExploreConfigOutput } from '../dto/explore-config.dto';
import { ToolName } from './tool-definitions';

/**
 * Input types for each tool.
 */
interface GetDimensionsInput {}

interface GetMetricsInput {}

interface GetDimensionValuesInput {
  dimension: string;
  period?: string;
  search?: string;
  limit?: number;
}

interface PreviewQueryInput {
  dimensions: string[];
  filters?: Array<{
    dimension: string;
    operator: string;
    values?: unknown[];
  }>;
  period: string;
  limit?: number;
}

interface ConfigureExploreInput {
  dimensions?: string[];
  filters?: Array<{
    dimension: string;
    operator: string;
    values?: unknown[];
  }>;
  period?: string;
  comparison?: string;
  minSessions?: number;
  customStart?: string;
  customEnd?: string;
}

/**
 * Tool execution results.
 */
interface DimensionInfo {
  name: string;
  type: string;
  category: string;
}

interface MetricInfo {
  name: string;
  description: string;
}

interface PreviewResult {
  row_count: number;
  sample_data: Record<string, unknown>[];
  dimensions_used: string[];
}

interface DimensionValuesResult {
  dimension: string;
  values: Array<{ value: string | null; sessions: number }>;
  total_unique: number;
}

interface ConfigureResult {
  success: boolean;
  config: ExploreConfigOutput;
}

/**
 * Cache for dimensions and metrics (5 minute TTL).
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let dimensionsCache: { data: DimensionInfo[]; timestamp: number } | null = null;
let metricsCache: { data: MetricInfo[]; timestamp: number } | null = null;

/**
 * Tool executor for AI assistant.
 */
export class ToolExecutor {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly workspaceId: string,
  ) {}

  /**
   * Execute a tool by name.
   */
  async execute(name: ToolName, input: unknown): Promise<unknown> {
    switch (name) {
      case 'get_dimensions':
        return this.getDimensions();
      case 'get_metrics':
        return this.getMetrics();
      case 'get_dimension_values':
        return this.getDimensionValues(input as GetDimensionValuesInput);
      case 'preview_query':
        return this.previewQuery(input as PreviewQueryInput);
      case 'configure_explore':
        return this.configureExplore(input as ConfigureExploreInput);
      default:
        throw new BadRequestException(`Unknown tool: ${name}`);
    }
  }

  /**
   * Get all available dimensions.
   */
  private getDimensions(): DimensionInfo[] {
    const now = Date.now();

    if (dimensionsCache && now - dimensionsCache.timestamp < CACHE_TTL_MS) {
      return dimensionsCache.data;
    }

    const dimensions = Object.entries(DIMENSIONS).map(([key, def]) => ({
      name: key,
      type: def.type,
      category: def.category,
    }));

    dimensionsCache = { data: dimensions, timestamp: now };
    return dimensions;
  }

  /**
   * Get all available metrics.
   */
  private getMetrics(): MetricInfo[] {
    const now = Date.now();

    if (metricsCache && now - metricsCache.timestamp < CACHE_TTL_MS) {
      return metricsCache.data;
    }

    const metrics = Object.entries(METRICS).map(([key, def]) => ({
      name: key,
      description: def.description,
    }));

    metricsCache = { data: metrics, timestamp: now };
    return metrics;
  }

  /**
   * Get values for a specific dimension.
   */
  private async getDimensionValues(
    input: GetDimensionValuesInput,
  ): Promise<DimensionValuesResult> {
    // Validate dimension exists
    if (!DIMENSIONS[input.dimension]) {
      throw new BadRequestException(
        `Unknown dimension: ${input.dimension}. Use get_dimensions to see available options.`,
      );
    }

    const period = (input.period as DatePreset) || 'last_30_days';
    if (!DATE_PRESETS.includes(period)) {
      throw new BadRequestException(
        `Invalid period: ${input.period}. Valid options: ${DATE_PRESETS.join(', ')}`,
      );
    }

    const limit = Math.min(input.limit || 20, 100);

    try {
      // Query to get unique values with session counts
      const result = await this.analyticsService.query({
        workspace_id: this.workspaceId,
        metrics: ['sessions'],
        dimensions: [input.dimension],
        dateRange: { preset: period },
        limit: 500, // Get more to filter/search
        order: { sessions: 'desc' },
      });

      const data = result.data as Array<Record<string, unknown>>;

      // Filter by search term if provided
      let values = data.map((row) => ({
        value: row[input.dimension] as string | null,
        sessions: row.sessions as number,
      }));

      if (input.search) {
        const searchLower = input.search.toLowerCase();
        values = values.filter((v) =>
          v.value?.toLowerCase().includes(searchLower),
        );
      }

      // Apply limit
      values = values.slice(0, limit);

      return {
        dimension: input.dimension,
        values,
        total_unique: result.meta.total_rows,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to get dimension values: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Execute a preview query.
   */
  private async previewQuery(input: PreviewQueryInput): Promise<PreviewResult> {
    // Validate dimensions limit
    if (input.dimensions.length > 3) {
      throw new BadRequestException(
        'Preview query limited to 3 dimensions. Reduce dimensions.',
      );
    }

    // Validate period is provided
    if (!input.period) {
      throw new BadRequestException(
        'Period is required for preview query.',
      );
    }

    // Validate period is valid
    if (!DATE_PRESETS.includes(input.period as DatePreset)) {
      throw new BadRequestException(
        `Invalid period: ${input.period}. Valid options: ${DATE_PRESETS.join(', ')}`,
      );
    }

    // Validate dimensions exist
    for (const dim of input.dimensions) {
      if (!DIMENSIONS[dim]) {
        throw new BadRequestException(
          `Unknown dimension: ${dim}. Use get_dimensions to see available options.`,
        );
      }
    }

    const limit = Math.min(input.limit || 10, 100);

    try {
      const result = await this.analyticsService.query({
        workspace_id: this.workspaceId,
        metrics: ['sessions', 'median_duration'],
        dimensions: input.dimensions,
        filters: input.filters?.map((f) => ({
          dimension: f.dimension,
          operator: f.operator as never,
          values: f.values as never,
        })),
        dateRange: { preset: input.period as DatePreset },
        limit,
        order: { sessions: 'desc' },
      });

      const data = result.data as Record<string, unknown>[];

      return {
        row_count: result.meta.total_rows,
        sample_data: data.slice(0, 5),
        dimensions_used: input.dimensions,
      };
    } catch (error) {
      throw new BadRequestException(
        `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Configure explore page.
   */
  private configureExplore(input: ConfigureExploreInput): ConfigureResult {
    // Validate dimensions
    if (input.dimensions) {
      if (input.dimensions.length > 5) {
        throw new BadRequestException('Maximum 5 dimensions allowed.');
      }
      for (const dim of input.dimensions) {
        if (!DIMENSIONS[dim]) {
          throw new BadRequestException(
            `Unknown dimension: ${dim}. Use get_dimensions to see available options.`,
          );
        }
      }
    }

    // Validate period
    if (input.period && !DATE_PRESETS.includes(input.period as DatePreset)) {
      throw new BadRequestException(
        `Invalid period: ${input.period}. Valid options: ${DATE_PRESETS.join(', ')}`,
      );
    }

    // Validate comparison
    if (
      input.comparison &&
      !['previous_period', 'previous_year', 'none'].includes(input.comparison)
    ) {
      throw new BadRequestException(
        `Invalid comparison: ${input.comparison}. Valid options: previous_period, previous_year, none`,
      );
    }

    // Coerce minSessions to number (AI may return string)
    const minSessions =
      input.minSessions !== undefined
        ? Number(input.minSessions)
        : undefined;

    // Build config
    const config: ExploreConfigOutput = {
      dimensions: input.dimensions,
      filters: input.filters?.map((f) => ({
        dimension: f.dimension,
        operator: f.operator as never,
        values: f.values as never,
      })),
      period: input.period as DatePreset,
      comparison: input.comparison as
        | 'previous_period'
        | 'previous_year'
        | 'none',
      minSessions:
        minSessions !== undefined && !isNaN(minSessions)
          ? minSessions
          : undefined,
      customStart: input.customStart,
      customEnd: input.customEnd,
    };

    return { success: true, config };
  }
}
