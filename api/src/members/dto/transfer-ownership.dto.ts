import { IsString } from 'class-validator';

export class TransferOwnershipDto {
  @IsString()
  workspace_id: string;

  @IsString()
  new_owner_id: string;
}
