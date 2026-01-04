import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  token: string;

  // For new users only
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  // For new users only
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}

export class InvitationDetailsDto {
  id: string;
  workspace: {
    id: string;
    name: string;
    website: string;
    logo_url?: string;
  };
  email: string;
  role: string;
  inviter: {
    name: string;
  };
  existingUser: boolean;
  expiresAt: string;
}
