import { IsOptional, IsString, IsIn } from 'class-validator';
import type { ApiKeyStatus } from '../../common/entities/api-key.entity';

export class ListApiKeysDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;

  @IsOptional()
  @IsIn(['active', 'revoked', 'expired'])
  status?: ApiKeyStatus;
}
