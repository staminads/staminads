import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UserEventsQueryDto {
  @IsString()
  workspace_id: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsDateString()
  until: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}

export interface UserEventRow {
  id: string;
  session_id: string;
  user_id: string;
  name: 'screen_view' | 'goal';
  path: string;
  created_at: string;
  updated_at: string;
  referrer: string;
  referrer_domain: string;
  is_direct: boolean;
  landing_page: string;
  landing_domain: string;
  landing_path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  utm_id: string;
  utm_id_from: string;
  channel: string;
  channel_group: string;
  stm_1: string;
  stm_2: string;
  stm_3: string;
  stm_4: string;
  stm_5: string;
  stm_6: string;
  stm_7: string;
  stm_8: string;
  stm_9: string;
  stm_10: string;
  device: string;
  browser: string;
  browser_type: string;
  os: string;
  country: string;
  region: string;
  city: string;
  language: string;
  timezone: string;
  goal_name: string;
  goal_value: number;
  goal_timestamp: string | null;
  page_number: number;
  duration: number;
  max_scroll: number;
}

export interface UserEventsResponse {
  data: UserEventRow[];
  next_cursor: string | null;
  has_more: boolean;
}
