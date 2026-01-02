import {
  IsOptional,
  IsString,
  IsUrl,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsUrl()
  website: string;

  @IsString()
  timezone: string;

  @IsString()
  currency: string;

  @IsOptional()
  @IsUrl()
  logo_url?: string;

  // Geo settings (optional, defaults applied in service)
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
