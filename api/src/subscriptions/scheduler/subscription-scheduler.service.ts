import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionsService } from '../subscriptions.service';
import { ReportGeneratorService } from '../report/report-generator.service';
import { MailService } from '../../mail/mail.service';
import { UsersService } from '../../users/users.service';
import { AuditService } from '../../audit/audit.service';
import { Subscription } from '../entities/subscription.entity';

@Injectable()
export class SubscriptionSchedulerService {
  private readonly logger = new Logger(SubscriptionSchedulerService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly reportGenerator: ReportGeneratorService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Run every 15 minutes to check for due subscriptions
   */
  @Cron('0 */15 * * * *')
  async processScheduledReports(): Promise<void> {
    this.logger.log('Processing scheduled reports...');

    const dueSubscriptions = await this.subscriptionsService.findDue();
    this.logger.log(`Found ${dueSubscriptions.length} due subscriptions`);

    for (const subscription of dueSubscriptions) {
      await this.processSubscription(subscription);
    }
  }

  private async processSubscription(subscription: Subscription): Promise<void> {
    try {
      // Re-fetch to check if another instance already processed this
      const current = await this.subscriptionsService.getById(subscription.id);

      // Skip if subscription no longer exists, is no longer active, or next_send_at changed
      if (
        !current ||
        current.status !== 'active' ||
        current.next_send_at !== subscription.next_send_at
      ) {
        this.logger.log(
          `Subscription ${subscription.id} already processed by another instance, skipping`,
        );
        return;
      }

      // Get user email
      const user = await this.usersService.findById(subscription.user_id);
      if (!user) {
        throw new Error(`User not found: ${subscription.user_id}`);
      }

      // Validate user has email
      if (!user.email) {
        throw new Error(`User ${subscription.user_id} has no email address`);
      }

      // Generate report data
      const reportData = await this.reportGenerator.generate(subscription);

      // Render email
      const html = this.reportGenerator.renderEmail(reportData, subscription);

      // Send email
      const subject = `${subscription.name} - ${reportData.dateRangeLabel}`;
      await this.mailService.sendReport(
        subscription.workspace_id,
        user.email,
        subject,
        html,
      );

      // Mark as sent
      await this.subscriptionsService.markSent(subscription.id);

      // Audit log
      await this.auditService.log({
        action: 'subscription.report_sent',
        user_id: subscription.user_id,
        workspace_id: subscription.workspace_id,
        target_type: 'subscription',
        target_id: subscription.id,
        metadata: {
          subscription_id: subscription.id,
          email: user.email,
        },
      });

      this.logger.log(`Report sent for subscription ${subscription.id}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Mark as failed
      await this.subscriptionsService.markFailed(subscription.id, errorMessage);

      // Audit log
      await this.auditService.log({
        action: 'subscription.report_failed',
        user_id: subscription.user_id,
        workspace_id: subscription.workspace_id,
        target_type: 'subscription',
        target_id: subscription.id,
        metadata: {
          subscription_id: subscription.id,
          error: errorMessage,
        },
      });

      this.logger.error(
        `Failed to send report for subscription ${subscription.id}: ${errorMessage}`,
      );
    }
  }
}
