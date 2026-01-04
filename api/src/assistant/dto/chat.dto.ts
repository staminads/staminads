import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  ValidateNested,
  IsNumber,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FilterDto,
  DATE_PRESETS,
} from '../../analytics/dto/analytics-query.dto';
import type { DatePreset } from '../../analytics/dto/analytics-query.dto';

/**
 * Current state of the Explore page.
 */
export class ExploreStateDto {
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
  @IsString()
  @IsIn([...DATE_PRESETS])
  period?: DatePreset;

  @IsOptional()
  @IsString()
  @IsIn(['previous_period', 'previous_year', 'none'])
  comparison?: 'previous_period' | 'previous_year' | 'none';

  @IsOptional()
  @IsNumber()
  minSessions?: number;

  @IsOptional()
  @IsString()
  customStart?: string;

  @IsOptional()
  @IsString()
  customEnd?: string;
}

/**
 * Message in conversation history.
 */
export class MessageDto {
  @IsString()
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

/**
 * Request to start an AI assistant chat session.
 */
export class ChatRequestDto {
  @IsString()
  workspace_id: string;

  @IsString()
  @MaxLength(2000)
  prompt: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExploreStateDto)
  current_state?: ExploreStateDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages?: MessageDto[];
}

/**
 * Response from creating a chat job.
 */
export interface ChatJobResponse {
  job_id: string;
}
