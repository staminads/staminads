import { IsString, IsIn } from 'class-validator';
import type { Role } from '../../common/entities/membership.entity';

export class UpdateRoleDto {
  @IsString()
  workspace_id: string;

  @IsString()
  user_id: string;

  @IsString()
  @IsIn(['owner', 'admin', 'editor', 'viewer'])
  role: Role;
}
