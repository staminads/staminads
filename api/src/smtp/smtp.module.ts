import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmtpService } from './smtp.service';
import { SmtpController } from './smtp.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [ConfigModule, WorkspacesModule, forwardRef(() => MailModule)],
  controllers: [SmtpController],
  providers: [SmtpService],
  exports: [SmtpService],
})
export class SmtpModule {}
