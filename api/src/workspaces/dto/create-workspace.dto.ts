import {
  IsOptional,
  IsString,
  IsUrl,
  IsBoolean,
  IsNumber,
  IsObject,
  IsArray,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnnotationDto } from './update-workspace.dto';

export class CreateWorkspaceSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  timescore_reference?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  bounce_threshold?: number;

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
}

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'ID must start with a letter and contain only lowercase letters, numbers, and underscores',
  })
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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateWorkspaceSettingsDto)
  settings?: CreateWorkspaceSettingsDto;
}
