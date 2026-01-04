import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [
    ConfigModule,
    WorkspacesModule,
    AnalyticsModule,
    forwardRef(() => MembersModule),
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
