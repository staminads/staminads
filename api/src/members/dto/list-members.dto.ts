import { IsString } from 'class-validator';

export class ListMembersDto {
  @IsString()
  workspace_id: string;
}
