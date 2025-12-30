import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomDimensionRuleDto } from './create-custom-dimension.dto';

export class UpdateCustomDimensionDto {
  @ApiProperty({ description: 'Workspace ID', example: 'ws_abc123' })
  @IsString()
  @IsNotEmpty()
  workspace_id: string;

  @ApiProperty({ description: 'Custom dimension ID to update', example: 'cd_xyz789' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'Display name', example: 'Channel Grouping' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Category for UI grouping', example: 'Custom' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Rules to evaluate (first match wins)',
    type: [CustomDimensionRuleDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomDimensionRuleDto)
  @ArrayMinSize(1)
  rules?: CustomDimensionRuleDto[];

  @ApiPropertyOptional({
    description: 'Default value when no rule matches',
    example: 'Other',
  })
  @IsOptional()
  @IsString()
  defaultValue?: string;
}
