import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsUrl()
  website: string;

  @IsString()
  timezone: string;

  @IsString()
  currency: string;

  @IsOptional()
  @IsUrl()
  logo_url?: string;
}
