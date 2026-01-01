import {
  IsOptional,
  IsString,
  IsUrl,
  IsArray,
  IsObject,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { FilterDefinition } from '../../filters/entities/filter.entity';

export class UpdateWorkspaceDto {
  @IsString()
  id: string;

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
}
