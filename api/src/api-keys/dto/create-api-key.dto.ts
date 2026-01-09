import {
  IsString,
  IsOptional,
  IsDateString,
  MinLength,
  MaxLength,
  IsIn,
} from 'class-validator';
import type { ApiKeyRole } from '../../common/entities/api-key.entity';

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsString()
  workspace_id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsIn(['admin', 'editor', 'viewer'])
  role: ApiKeyRole;

  @IsOptional()
  @IsDateString()
  expires_at?: string | null;
}
