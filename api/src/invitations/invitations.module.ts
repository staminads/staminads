import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    MailModule,
    WorkspacesModule,
    forwardRef(() => MembersModule),
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
