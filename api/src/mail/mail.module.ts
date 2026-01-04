import { Module, forwardRef } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmtpModule } from '../smtp/smtp.module';

@Module({
  imports: [forwardRef(() => SmtpModule)],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
