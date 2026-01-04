import { Module, forwardRef } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [WorkspacesModule, forwardRef(() => MembersModule)],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
