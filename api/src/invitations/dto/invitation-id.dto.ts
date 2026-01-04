import { IsString } from 'class-validator';

export class InvitationIdDto {
  @IsString()
  id: string;
}
