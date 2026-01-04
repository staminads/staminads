import { IsString } from 'class-validator';

export class GetMemberDto {
  @IsString()
  workspace_id: string;

  @IsString()
  user_id: string;
}
