import { IsOptional, IsString, IsUrl, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomDimensionDefinition } from '../../custom-dimensions/entities/custom-dimension.entity';
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
  @IsArray()
  custom_dimensions?: CustomDimensionDefinition[];

  @IsOptional()
  @IsArray()
  filters?: FilterDefinition[];
}
