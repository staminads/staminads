import {
  IsOptional,
  IsString,
  IsUrl,
  IsEmail,
  IsArray,
  IsObject,
  IsNumber,
  IsBoolean,
  IsIn,
  IsDateString,
  Min,
  Max,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FilterDefinition } from '../../filters/entities/filter.entity';
import { Integration } from '../entities/integration.entity';
import type { WorkspaceStatus } from '../entities/workspace.entity';

export class AnnotationDto {
  @IsString()
  id: string;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  time: string;

  @IsString()
  timezone: string;

  @IsString()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;
}

export class SmtpSettingsUpdateDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(255)
  host: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password_encrypted?: string;

  @IsString()
  @MaxLength(100)
  from_name: string;

  @IsEmail()
  from_email: string;
}

export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  timescore_reference?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  bounce_threshold?: number;

  @IsOptional()
  @IsObject()
  custom_dimensions?: Record<string, string>;

  @IsOptional()
  @IsArray()
  filters?: FilterDefinition[];

  @IsOptional()
  @IsArray()
  integrations?: Integration[];

  @IsOptional()
  @IsBoolean()
  geo_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  geo_store_city?: boolean;

  @IsOptional()
  @IsBoolean()
  geo_store_region?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  geo_coordinates_precision?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnnotationDto)
  annotations?: AnnotationDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SmtpSettingsUpdateDto)
  smtp?: SmtpSettingsUpdateDto;
}

export class UpdateWorkspaceDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsIn(['initializing', 'active', 'inactive', 'error'])
  status?: WorkspaceStatus;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsUrl()
  logo_url?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateWorkspaceSettingsDto)
  settings?: UpdateWorkspaceSettingsDto;
}
