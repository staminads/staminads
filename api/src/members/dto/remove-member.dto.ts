import { IsString } from 'class-validator';

export class RemoveMemberDto {
  @IsString()
  workspace_id: string;

  @IsString()
  user_id: string;
}
