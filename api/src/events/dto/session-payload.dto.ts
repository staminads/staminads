import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
  IsIn,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { IsWithinTimeBounds } from '../../common/validators/time-bounds.validator';
import { IsGreaterThanOrEqual } from '../../common/validators/compare.validator';

// Constants
export const MAX_ACTIONS = 1000;
export const MAX_PATH_LENGTH = 2048;
export const MAX_GOAL_NAME_LENGTH = 100;
export const TIMESTAMP_BOUNDS_HOURS = 24;

// === Action DTOs ===

export class PageviewActionDto {
  @IsIn(['pageview'])
  type: 'pageview';

  @IsString()
  @MaxLength(MAX_PATH_LENGTH)
  path: string;

  @IsNumber()
  @Min(1)
  page_number: number;

  @IsNumber()
  @Min(0)
  duration: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  scroll: number;

  @IsNumber()
  entered_at: number;

  @IsNumber()
  @IsGreaterThanOrEqual('entered_at', {
    message: 'exited_at must be greater than or equal to entered_at',
  })
  exited_at: number;
}

export class GoalActionDto {
  @IsIn(['goal'])
  type: 'goal';

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_GOAL_NAME_LENGTH)
  name: string;

  @IsString()
  @MaxLength(MAX_PATH_LENGTH)
  path: string;

  @IsNumber()
  @Min(1)
  page_number: number;

  @IsNumber()
  timestamp: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsObject()
  properties?: Record<string, string>;
}

// === Current Page DTO ===

export class CurrentPageDto {
  @IsString()
  @MaxLength(MAX_PATH_LENGTH)
  path: string;

  @IsNumber()
  @Min(1)
  page_number: number;

  @IsNumber()
  entered_at: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  scroll: number;
}

// === Session Attributes DTO ===

export class SessionAttributesDto {
  @IsOptional()
  @IsString()
  referrer?: string;

  @IsString()
  landing_page: string;

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
}

// === Session Payload DTO ===

export class SessionPayloadDto {
  @IsString()
  @IsNotEmpty()
  workspace_id: string;

  @IsString()
  @IsNotEmpty()
  session_id: string;

  @IsArray()
  @ArrayMaxSize(MAX_ACTIONS)
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: PageviewActionDto, name: 'pageview' },
        { value: GoalActionDto, name: 'goal' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  actions: (PageviewActionDto | GoalActionDto)[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CurrentPageDto)
  current_page?: CurrentPageDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  checkpoint?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionAttributesDto)
  attributes?: SessionAttributesDto;

  @IsNumber()
  @IsWithinTimeBounds(TIMESTAMP_BOUNDS_HOURS, 'both')
  created_at: number;

  @IsNumber()
  @IsWithinTimeBounds(TIMESTAMP_BOUNDS_HOURS, 'both')
  updated_at: number;

  @IsOptional()
  @IsString()
  sdk_version?: string;

  @IsOptional()
  @IsNumber()
  sent_at?: number;
}

// === Type Guards ===

export type Action = PageviewActionDto | GoalActionDto;

export function isPageviewAction(action: Action): action is PageviewActionDto {
  return action.type === 'pageview';
}

export function isGoalAction(action: Action): action is GoalActionDto {
  return action.type === 'goal';
}
