import { Module, Global, forwardRef } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { MembersModule } from '../members/members.module';

@Global()
@Module({
  imports: [forwardRef(() => MembersModule)],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
