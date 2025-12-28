import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateWorkspaceDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsUrl()
  logo_url?: string;
}
