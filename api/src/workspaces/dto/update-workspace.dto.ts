import {
  IsOptional,
  IsString,
  IsUrl,
  IsArray,
  IsObject,
  IsNumber,
  IsBoolean,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { FilterDefinition } from '../../filters/entities/filter.entity';
import { Integration } from '../entities/integration.entity';
import type { WorkspaceStatus } from '../entities/workspace.entity';

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
  custom_dimensions?: Record<string, string>;

  @IsOptional()
  @IsArray()
  filters?: FilterDefinition[];

  @IsOptional()
  @IsArray()
  integrations?: Integration[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  timescore_reference?: number;

  // Geo settings
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
  @IsNumber()
  @Min(1)
  bounce_threshold?: number;
}
