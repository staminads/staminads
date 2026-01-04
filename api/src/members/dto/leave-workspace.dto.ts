import { IsString } from 'class-validator';

export class LeaveWorkspaceDto {
  @IsString()
  workspace_id: string;
}
