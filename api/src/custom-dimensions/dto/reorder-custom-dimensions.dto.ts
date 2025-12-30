import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderCustomDimensionsDto {
  @ApiProperty({ description: 'Workspace ID', example: 'ws_abc123' })
  @IsString()
  @IsNotEmpty()
  workspace_id: string;

  @ApiProperty({
    description: 'Ordered list of custom dimension IDs',
    example: ['cd_xyz789', 'cd_abc123', 'cd_def456'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  dimension_ids: string[];
}
