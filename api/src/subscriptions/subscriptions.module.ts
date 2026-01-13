import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { ReportGeneratorService } from './report/report-generator.service';
import { SubscriptionSchedulerService } from './scheduler/subscription-scheduler.service';
import { DatabaseModule } from '../database/database.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MailModule } from '../mail/mail.module';
import { SmtpModule } from '../smtp/smtp.module';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [
    DatabaseModule,
    WorkspacesModule,
    forwardRef(() => AnalyticsModule),
    MailModule,
    SmtpModule,
    UsersModule,
    AuditModule,
    MembersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          configService.get<string>('ENCRYPTION_KEY'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    ReportGeneratorService,
    SubscriptionSchedulerService,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
