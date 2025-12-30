import {
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
  IsBoolean,
  ValidateNested,
  ArrayMinSize,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SOURCE_FIELDS, WRITABLE_DIMENSIONS } from '../entities/filter.entity';

export class FilterConditionDto {
  @IsString()
  @IsIn([...SOURCE_FIELDS])
  field: string;

  @IsString()
  @IsIn(['equals', 'regex', 'contains'])
  operator: string;

  @IsString()
  value: string;
}

export class FilterOperationDto {
  @IsString()
  @IsIn([...WRITABLE_DIMENSIONS])
  dimension: string;

  @IsString()
  @IsIn(['set_value', 'unset_value', 'set_default_value'])
  action: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class CreateFilterDto {
  @IsString()
  workspace_id: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  priority?: number; // Default: 500

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]; // Default: []

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FilterConditionDto)
  conditions: FilterConditionDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FilterOperationDto)
  operations: FilterOperationDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean; // Default: true
}
