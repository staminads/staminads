import { IsEmail, IsString, IsIn } from 'class-validator';
import { Role } from '../../common/entities';

export class CreateInvitationDto {
  @IsString()
  workspace_id: string;

  @IsEmail()
  email: string;

  @IsIn(['admin', 'editor', 'viewer'])
  role: Exclude<Role, 'owner'>;
}
