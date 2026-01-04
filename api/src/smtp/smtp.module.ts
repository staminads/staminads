import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmtpService } from './smtp.service';
import { SmtpController } from './smtp.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MailModule } from '../mail/mail.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => WorkspacesModule),
    forwardRef(() => MailModule),
    forwardRef(() => MembersModule),
  ],
  controllers: [SmtpController],
  providers: [SmtpService],
  exports: [SmtpService],
})
export class SmtpModule {}
