import {
  IsString,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Min,
  Max,
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

export class UpdateSubscriptionDto {
  @IsString()
  id: string;

  @IsString()
  workspace_id: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(SUBSCRIPTION_FREQUENCIES)
  frequency?: SubscriptionFrequency;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  day_of_week?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(28)
  day_of_month?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...AVAILABLE_METRICS], { each: true })
  metrics?: string[];

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
