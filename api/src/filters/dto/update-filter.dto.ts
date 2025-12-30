import {
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
  IsBoolean,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FilterConditionDto, FilterOperationDto } from './create-filter.dto';

export class UpdateFilterDto {
  @IsString()
  workspace_id: string;

  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterConditionDto)
  conditions?: FilterConditionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterOperationDto)
  operations?: FilterOperationDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
