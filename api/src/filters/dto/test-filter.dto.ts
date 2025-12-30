import {
  IsString,
  IsArray,
  IsOptional,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FilterConditionDto, FilterOperationDto } from './create-filter.dto';

export class TestFilterDto {
  @IsString()
  workspace_id: string;

  @IsOptional()
  @IsString()
  filter_id?: string; // Test an existing filter

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterConditionDto)
  conditions?: FilterConditionDto[]; // Test conditions

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterOperationDto)
  operations?: FilterOperationDto[]; // Operations for testing

  @IsObject()
  testValues: Record<string, string | null>; // Field values to test against
}

export interface TestFilterResult {
  inputValues: Record<string, string | null>;
  matches: boolean;
  operationResults: Array<{
    dimension: string;
    action: string;
    resultValue: string | null;
  }>;
}
