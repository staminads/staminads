import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  MinLength,
  MaxLength,
  ArrayMinSize,
  IsIn,
} from 'class-validator';
import { API_SCOPES, ApiScope } from '../../common/entities/api-key.entity';

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

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.keys(API_SCOPES), { each: true })
  scopes: ApiScope[];

  @IsOptional()
  @IsDateString()
  expires_at?: string | null;
}
