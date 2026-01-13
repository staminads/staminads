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
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FilterDto } from '../../analytics/dto/analytics-query.dto';

export const SUBSCRIPTION_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

export const AVAILABLE_METRICS = [
  'sessions',
  'median_duration',
  'bounce_rate',
  'median_scroll',
] as const;

export const AVAILABLE_DIMENSIONS = [
  'landing_path',
  'exit_path',
  'referrer_domain',
  'channel',
  'channel_group',
  'utm_campaign',
  'utm_source',
  'utm_medium',
  'utm_content',
  'utm_term',
  'country',
  'device',
  'browser',
  'os',
  'goal_name',
] as const;

export const AVAILABLE_LIMITS = [5, 10, 15, 20, 50] as const;

export class CreateSubscriptionDto {
  @IsString()
  workspace_id: string;

  @IsString()
  name: string;

  @IsIn(SUBSCRIPTION_FREQUENCIES)
  frequency: SubscriptionFrequency;

  @ValidateIf((o) => o.frequency === 'weekly')
  @IsNumber()
  @Min(1)
  @Max(7)
  day_of_week?: number;

  @ValidateIf((o) => o.frequency === 'monthly')
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
