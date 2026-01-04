import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalyticsModule } from './analytics/analytics.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AssistantModule } from './assistant/assistant.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { DemoModule } from './demo/demo.module';
import { EventsModule } from './events/events.module';
import { FiltersModule } from './filters/filters.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { MembersModule } from './members/members.module';
import { SmtpModule } from './smtp/smtp.module';
import { ToolsModule } from './tools/tools.module';
import { UsersModule } from './users/users.module';
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
    AuditModule,
    UsersModule,
    WorkspacesModule,
    ApiKeysModule,
    SmtpModule,
    MailModule,
    InvitationsModule,
    MembersModule,
    FiltersModule,
    ToolsModule,
    DemoModule,
    EventsModule,
    AnalyticsModule,
    AssistantModule,
  ],
})
export class AppModule {}
