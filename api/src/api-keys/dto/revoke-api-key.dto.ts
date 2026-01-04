import { IsString } from 'class-validator';

export class RevokeApiKeyDto {
  @IsString()
  id: string;

  @IsString()
  revoked_by: string;
}
