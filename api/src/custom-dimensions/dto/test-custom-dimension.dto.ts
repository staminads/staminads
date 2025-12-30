import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomDimensionRuleDto } from './create-custom-dimension.dto';

export class TestCustomDimensionDto {
  @ApiProperty({ description: 'Workspace ID', example: 'ws_abc123' })
  @IsString()
  @IsNotEmpty()
  workspace_id: string;

  @ApiPropertyOptional({
    description: 'Existing custom dimension ID to test',
    example: 'cd_xyz789',
  })
  @IsOptional()
  @IsString()
  dimension_id?: string;

  @ApiPropertyOptional({
    description: 'Rules to test (if not testing existing dimension)',
    type: [CustomDimensionRuleDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomDimensionRuleDto)
  rules?: CustomDimensionRuleDto[];

  @ApiPropertyOptional({
    description: 'Default value to test with',
    example: 'Other',
  })
  @IsOptional()
  @IsString()
  defaultValue?: string;

  @ApiProperty({
    description: 'Test values - object mapping field names to values',
    example: { utm_source: 'google.com', utm_medium: 'cpc' },
  })
  @IsObject()
  testValues: Record<string, string | null>;
}

export class TestResult {
  @ApiProperty({ description: 'Input field values' })
  inputValues: Record<string, string | null>;

  @ApiProperty({ description: 'Index of matched rule (null if default)', nullable: true })
  matchedRuleIndex: number | null;

  @ApiProperty({ description: 'Output value', nullable: true })
  outputValue: string | null;
}
