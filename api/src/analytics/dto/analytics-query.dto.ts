import {
  IsString,
  IsArray,
  IsOptional,
  IsObject,
  ValidateNested,
  IsIn,
  IsNumber,
  Min,
  Max,
  ArrayMinSize,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AnalyticsTable } from '../constants/tables';
import { ANALYTICS_TABLES } from '../constants/tables';

export const FILTER_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'contains',
  'notContains',
  'gt',
  'gte',
  'lt',
  'lte',
  'isNull',
  'isNotNull',
  'between',
  'isEmpty',
  'isNotEmpty',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export class FilterDto {
  @IsString()
  dimension: string;

  @IsIn(FILTER_OPERATORS)
  operator: FilterOperator;

  @IsOptional()
  @IsArray()
  values?: (string | number | null)[];
}

// Metric filters are applied in HAVING clause (post-aggregation)
export const METRIC_FILTER_OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
] as const;

export type MetricFilterOperator = (typeof METRIC_FILTER_OPERATORS)[number];

export class MetricFilterDto {
  @IsString()
  metric: string;

  @IsIn(METRIC_FILTER_OPERATORS)
  operator: MetricFilterOperator;

  @IsArray()
  values: (number | null)[];
}

export const GRANULARITIES = ['hour', 'day', 'week', 'month', 'year'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const DATE_PRESETS = [
  'previous_30_minutes',
  'today',
  'yesterday',
  'previous_7_days',
  'previous_14_days',
  'previous_28_days',
  'previous_30_days',
  'previous_90_days',
  'previous_91_days',
  'this_week',
  'previous_week',
  'this_month',
  'previous_month',
  'this_quarter',
  'previous_quarter',
  'this_year',
  'previous_year',
  'previous_12_months',
  'all_time',
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

export class DateRangeDto {
  @IsOptional()
  @IsString()
  start?: string;

  @IsOptional()
  @IsString()
  end?: string;

  @IsOptional()
  @IsIn(DATE_PRESETS)
  preset?: DatePreset;

  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: Granularity;
}

@ValidatorConstraint({ name: 'dateRangeValid', async: false })
export class DateRangeValidator implements ValidatorConstraintInterface {
  validate(dateRange: DateRangeDto) {
    if (!dateRange) return false;

    // Must have either preset OR start+end
    const hasPreset = !!dateRange.preset;
    const hasAbsolute = !!dateRange.start && !!dateRange.end;

    if (!hasPreset && !hasAbsolute) {
      return false; // Must provide something
    }
    if (hasPreset && hasAbsolute) {
      return false; // Can't have both
    }

    // If absolute dates, validate start < end
    if (hasAbsolute) {
      return new Date(dateRange.start!) < new Date(dateRange.end!);
    }

    return true;
  }

  defaultMessage() {
    return 'dateRange must have either preset OR (start AND end where start < end)';
  }
}

export class AnalyticsQueryDto {
  @IsString()
  workspace_id: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  metrics: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensions?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterDto)
  filters?: FilterDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetricFilterDto)
  metricFilters?: MetricFilterDto[];

  @Validate(DateRangeValidator)
  @ValidateNested()
  @Type(() => DateRangeDto)
  dateRange: DateRangeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DateRangeDto)
  compareDateRange?: DateRangeDto;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsObject()
  order?: Record<string, 'asc' | 'desc'>;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  havingMinSessions?: number;

  @IsOptional()
  @IsIn(ANALYTICS_TABLES)
  table?: AnalyticsTable;

  /**
   * When set, enables "filtered totals" mode for queries with no dimensions.
   * The query will:
   * 1. Group by these dimensions in an inner subquery
   * 2. Apply metricFilters via HAVING clause
   * 3. Aggregate the filtered results in an outer query
   *
   * Use this for totals that should respect metricFilters.
   * Example: Get total sessions where bounce_rate > 50%, grouped by landing_path.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  totalsGroupBy?: string[];
}
