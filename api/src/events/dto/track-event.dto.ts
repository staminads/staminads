import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsObject,
  ValidateNested,
  IsArray,
  Min,
  Max,
} from 'class-validator';

export class TrackEventDto {
  @IsString()
  workspace_id: string;

  @IsString()
  session_id: string;

  @IsString()
  name: string;

  @IsString()
  path: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  duration?: number;

  // Traffic source
  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  referrer_domain?: string;

  @IsOptional()
  @IsString()
  referrer_path?: string;

  @IsOptional()
  @IsBoolean()
  is_direct?: boolean;

  // Landing page
  @IsString()
  landing_page: string;

  @IsOptional()
  @IsString()
  landing_domain?: string;

  @IsOptional()
  @IsString()
  landing_path?: string;

  // UTM parameters
  @IsOptional()
  @IsString()
  utm_source?: string;

  @IsOptional()
  @IsString()
  utm_medium?: string;

  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @IsOptional()
  @IsString()
  utm_term?: string;

  @IsOptional()
  @IsString()
  utm_content?: string;

  @IsOptional()
  @IsString()
  utm_id?: string;

  @IsOptional()
  @IsString()
  utm_id_from?: string;

  // Device info
  @IsOptional()
  @IsNumber()
  screen_width?: number;

  @IsOptional()
  @IsNumber()
  screen_height?: number;

  @IsOptional()
  @IsNumber()
  viewport_width?: number;

  @IsOptional()
  @IsNumber()
  viewport_height?: number;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  browser?: string;

  @IsOptional()
  @IsString()
  browser_type?: string;

  @IsOptional()
  @IsString()
  os?: string;

  @IsOptional()
  @IsString()
  user_agent?: string;

  @IsOptional()
  @IsString()
  connection_type?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  // Engagement
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  max_scroll?: number;

  // Page duration tracking (v3)
  @IsOptional()
  @IsNumber()
  @Min(0)
  page_duration?: number;

  @IsOptional()
  @IsString()
  previous_path?: string;

  // SDK
  @IsOptional()
  @IsString()
  sdk_version?: string;

  // Timestamps (from SDK) - required
  @IsNumber()
  created_at: number;

  @IsNumber()
  updated_at: number;

  // Flexible properties
  @IsOptional()
  @IsObject()
  properties?: Record<string, string>;
}

export class TrackBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events: TrackEventDto[];
}
