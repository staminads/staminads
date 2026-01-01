import { IsOptional, IsString, IsUrl, IsArray, IsObject, IsNumber, Min } from 'class-validator';
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
}
