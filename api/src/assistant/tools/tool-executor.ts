import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from '../../analytics/analytics.service';
import { DIMENSIONS } from '../../analytics/constants/dimensions';
import {
  DATE_PRESETS,
  DatePreset,
} from '../../analytics/dto/analytics-query.dto';
import { ExploreConfigOutput } from '../dto/explore-config.dto';
import { ToolName } from './tool-definitions';

/**
 * Input types for each tool.
 */

interface GetDimensionValuesInput {
  dimension: string;
  period?: string;
  search?: string;
  limit?: number;
}

interface MetricFilterInput {
  metric: string;
  operator: string;
  values: number[];
}

interface PreviewQueryInput {
  dimensions: string[];
  filters?: Array<{
    dimension: string;
    operator: string;
    values?: unknown[];
  }>;
  metricFilters?: MetricFilterInput[];
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
  metricFilters?: MetricFilterInput[];
  period?: string;
  comparison?: string;
  minSessions?: number;
  customStart?: string;
  customEnd?: string;
}

/**
 * Tool execution results.
 */
interface PreviewResult {
  row_count: number;
  sample_data: Record<string, unknown>[];
  dimensions_used: string[];
  metric_filters_applied: number;
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
   * Get values for a specific dimension.
   */
  private async getDimensionValues(
    input: GetDimensionValuesInput,
  ): Promise<DimensionValuesResult> {
    // Validate dimension exists
    if (!DIMENSIONS[input.dimension]) {
      throw new BadRequestException(
        `Unknown dimension: ${input.dimension}. See available dimensions in the system prompt.`,
      );
    }

    const period = (input.period as DatePreset) || 'previous_30_days';
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
      throw new BadRequestException('Period is required for preview query.');
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
          `Unknown dimension: ${dim}. See available dimensions in the system prompt.`,
        );
      }
    }

    const limit = Math.min(input.limit || 10, 100);

    try {
      const result = await this.analyticsService.query({
        workspace_id: this.workspaceId,
        metrics: [
          'sessions',
          'bounce_rate',
          'median_duration',
          'median_scroll',
        ],
        dimensions: input.dimensions,
        filters: input.filters?.map((f) => ({
          dimension: f.dimension,
          operator: f.operator as never,
          values: f.values as never,
        })),
        metricFilters: input.metricFilters?.map((mf) => ({
          metric: mf.metric,
          operator: mf.operator as never,
          values: mf.values,
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
        metric_filters_applied: input.metricFilters?.length ?? 0,
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
            `Unknown dimension: ${dim}. See available dimensions in the system prompt.`,
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
      input.minSessions !== undefined ? Number(input.minSessions) : undefined;

    // Build config
    const config: ExploreConfigOutput = {
      dimensions: input.dimensions,
      filters: input.filters?.map((f) => ({
        dimension: f.dimension,
        operator: f.operator as never,
        values: f.values as never,
      })),
      metricFilters: input.metricFilters?.map((mf) => ({
        metric: mf.metric,
        operator: mf.operator as never,
        values: mf.values,
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
