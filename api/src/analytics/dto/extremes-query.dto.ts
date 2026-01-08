import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  IsNumber,
  Min,
  ArrayMinSize,
  Validate,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DateRangeDto,
  FilterDto,
  DateRangeValidator,
} from './analytics-query.dto';
import type { AnalyticsTable } from '../constants/tables';
import { ANALYTICS_TABLES } from '../constants/tables';

export class ExtremesQueryDto {
  @IsString()
  workspace_id: string;

  @IsString()
  metric: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  groupBy: string[];

  @Validate(DateRangeValidator)
  @ValidateNested()
  @Type(() => DateRangeDto)
  dateRange: DateRangeDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterDto)
  filters?: FilterDto[];

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  havingMinSessions?: number;

  @IsOptional()
  @IsIn(ANALYTICS_TABLES)
  table?: AnalyticsTable;
}

export interface ExtremesResponse {
  min: number | null;
  max: number | null;
  maxDimensionValues?: Record<string, string | number | null>;
  meta: {
    metric: string;
    groupBy: string[];
    dateRange: { start: string; end: string };
  };
}
