import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { validate } from './config/env.validation';
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
import { SetupModule } from './setup/setup.module';
import { SetupMiddleware } from './setup/setup.middleware';
import { SmtpModule } from './smtp/smtp.module';
import { ToolsModule } from './tools/tools.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'public'),
      exclude: ['/api/{*path}', '/health'],
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: 24 * 60 * 60 * 1000, // 24 hours in ms
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Disable rate limiting in test mode by setting extremely high limits
        const isTest = config.get('NODE_ENV') === 'test' ||
          config.get('CLICKHOUSE_SYSTEM_DATABASE')?.includes('test');
        if (isTest) {
          return {
            throttlers: [
              { name: 'auth', ttl: 1, limit: 1000000 },
              { name: 'default', ttl: 1, limit: 1000000 },
              { name: 'analytics', ttl: 1, limit: 1000000 },
            ],
          };
        }
        return {
          throttlers: [
            { name: 'auth', ttl: 60000, limit: 10 },
            { name: 'default', ttl: 60000, limit: 100 },
            { name: 'analytics', ttl: 60000, limit: 1000 },
          ],
        };
      },
    }),
    DatabaseModule,
    CommonModule,
    SetupModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SetupMiddleware).forRoutes('*');
  }
}
