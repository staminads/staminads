import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsIn,
  IsOptional,
  IsInt,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CustomDimensionOperator } from '../entities/custom-dimension.entity';

export class CustomDimensionConditionDto {
  @ApiProperty({ description: 'Source field to match against', example: 'utm_source' })
  @IsString()
  @IsNotEmpty()
  field: string;

  @ApiProperty({
    description: 'Match operator',
    enum: ['equals', 'regex', 'contains'],
    example: 'contains',
  })
  @IsIn(['equals', 'regex', 'contains'])
  operator: CustomDimensionOperator;

  @ApiProperty({ description: 'Value to match', example: 'google' })
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class CustomDimensionRuleDto {
  @ApiProperty({
    description: 'Conditions to match (combined with AND logic)',
    type: [CustomDimensionConditionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomDimensionConditionDto)
  @ArrayMinSize(1)
  conditions: CustomDimensionConditionDto[];

  @ApiProperty({ description: 'Output value when rule matches', example: 'Google' })
  @IsString()
  @IsNotEmpty()
  outputValue: string;
}

export class CreateCustomDimensionDto {
  @ApiProperty({ description: 'Workspace ID', example: 'ws_abc123' })
  @IsString()
  @IsNotEmpty()
  workspace_id: string;

  @ApiProperty({ description: 'Display name', example: 'Channel Grouping' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Slot number (1-10). If not provided, auto-assigns first available.',
    example: 1,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  slot?: number;

  @ApiPropertyOptional({ description: 'Category for UI grouping', example: 'Custom', default: 'Custom' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    description: 'Rules to evaluate (first match wins)',
    type: [CustomDimensionRuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomDimensionRuleDto)
  @ArrayMinSize(1)
  rules: CustomDimensionRuleDto[];

  @ApiPropertyOptional({
    description: 'Default value when no rule matches',
    example: 'Other',
  })
  @IsOptional()
  @IsString()
  defaultValue?: string;
}
