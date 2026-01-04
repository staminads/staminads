import {
  IsBoolean,
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

export class SmtpSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  from_name: string;

  @IsEmail()
  from_email: string;
}

export class UpdateSmtpDto extends SmtpSettingsDto {
  @IsString()
  workspace_id: string;
}

export class DeleteSmtpDto {
  @IsString()
  workspace_id: string;
}

export class TestSmtpDto {
  @IsString()
  workspace_id: string;

  @IsEmail()
  to_email: string;
}
