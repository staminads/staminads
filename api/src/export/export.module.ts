import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [WorkspacesModule, MembersModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
