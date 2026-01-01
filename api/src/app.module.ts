import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { DemoModule } from './demo/demo.module';
import { EventsModule } from './events/events.module';
import { FiltersModule } from './filters/filters.module';
import { ToolsModule } from './tools/tools.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: 24 * 60 * 60 * 1000, // 24 hours in ms
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    CommonModule,
    AuthModule,
    WorkspacesModule,
    FiltersModule,
    ToolsModule,
    DemoModule,
    EventsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
