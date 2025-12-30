import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';

export class StartBackfillDto {
  @IsString()
  workspace_id: string;

  @IsInt()
  @Min(1)
  @Max(365)
  lookback_days: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  chunk_size_days?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(50000)
  batch_size?: number;
}
