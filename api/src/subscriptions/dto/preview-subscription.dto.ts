import {
  IsString,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FilterDto } from '../../analytics/dto/analytics-query.dto';
import {
  SUBSCRIPTION_FREQUENCIES,
  AVAILABLE_METRICS,
  AVAILABLE_DIMENSIONS,
  AVAILABLE_LIMITS,
} from './create-subscription.dto';
import type { SubscriptionFrequency } from './create-subscription.dto';

export class PreviewSubscriptionDto {
  @IsString()
  workspace_id: string;

  @IsString()
  name: string;

  @IsIn(SUBSCRIPTION_FREQUENCIES)
  frequency: SubscriptionFrequency;

  @IsOptional()
  @IsNumber()
  day_of_week?: number;

  @IsOptional()
  @IsNumber()
  day_of_month?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...AVAILABLE_METRICS], { each: true })
  metrics: string[];

  @IsOptional()
  @IsArray()
  @IsIn([...AVAILABLE_DIMENSIONS], { each: true })
  dimensions?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterDto)
  filters?: FilterDto[];

  @IsOptional()
  @IsNumber()
  @IsIn([...AVAILABLE_LIMITS])
  limit?: number;
}
