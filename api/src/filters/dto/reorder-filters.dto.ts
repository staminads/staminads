import { IsString, IsArray, ArrayMinSize } from 'class-validator';

export class ReorderFiltersDto {
  @IsString()
  workspace_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  filter_ids: string[];
}
