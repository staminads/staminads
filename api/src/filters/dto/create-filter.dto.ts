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
import { Type, Transform } from 'class-transformer';
import { SOURCE_FIELDS, WRITABLE_DIMENSIONS } from '../entities/filter.entity';

export class FilterConditionDto {
  @IsString()
  @IsIn([...SOURCE_FIELDS])
  field: string;

  @IsString()
  @IsIn([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'is_empty',
    'is_not_empty',
    'regex',
  ])
  operator: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class FilterOperationDto {
  @IsString()
  @IsIn([...WRITABLE_DIMENSIONS])
  dimension: string;

  @IsString()
  @IsIn(['set_value', 'unset_value', 'set_default_value'])
  action: string;

  @IsOptional()
  @Transform(({ value }) => {
    // Normalize boolean values to strings for is_direct field
    if (value === true || value === 'true' || value === '1') return 'true';
    if (value === false || value === 'false' || value === '0') return 'false';
    return value;
  })
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
