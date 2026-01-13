import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionSchedulerService } from './subscription-scheduler.service';
import { SubscriptionsService } from '../subscriptions.service';
import { ReportGeneratorService } from '../report/report-generator.service';
import { MailService } from '../../mail/mail.service';
import { SmtpService } from '../../smtp/smtp.service';
import { UsersService } from '../../users/users.service';
import { AuditService } from '../../audit/audit.service';
import { Subscription } from '../entities/subscription.entity';

describe('SubscriptionSchedulerService', () => {
  let service: SubscriptionSchedulerService;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  let reportGenerator: jest.Mocked<ReportGeneratorService>;
  let mailService: jest.Mocked<MailService>;
  let smtpService: jest.Mocked<SmtpService>;
  let usersService: jest.Mocked<UsersService>;
  let auditService: jest.Mocked<AuditService>;

  const mockSubscription: Subscription = {
    id: 'sub-123',
    user_id: 'user-123',
    workspace_id: 'ws-123',
    name: 'Daily Report',
    frequency: 'daily',
    hour: 8,
    metrics: ['sessions', 'median_duration'],
    dimensions: ['landing_path', 'device'],
    filters: '[]',
    status: 'active',
    last_send_status: 'pending',
    last_error: '',
    next_send_at: new Date().toISOString(),
    consecutive_failures: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    type: 'user',
    status: 'active',
  };

  const mockReportData = {
    workspace: { id: 'ws-123', name: 'Test Workspace' },
    dateRange: { start: '2024-01-01', end: '2024-01-01' },
    dateRangeLabel: 'Jan 1, 2024',
    metrics: [],
    dimensions: [],
    dashboardUrl: 'http://localhost/workspaces/ws-123',
    unsubscribeUrl: 'http://localhost/unsubscribe?token=xxx',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionSchedulerService,
        {
          provide: SubscriptionsService,
          useValue: {
            findDue: jest.fn().mockResolvedValue([mockSubscription]),
            getById: jest.fn().mockResolvedValue(mockSubscription),
            markSent: jest.fn().mockResolvedValue(mockSubscription),
            markFailed: jest.fn().mockResolvedValue(mockSubscription),
          },
        },
        {
          provide: ReportGeneratorService,
          useValue: {
            generate: jest.fn().mockResolvedValue(mockReportData),
            renderEmail: jest.fn().mockReturnValue('<html>Report</html>'),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendReport: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SmtpService,
          useValue: {
            getInfo: jest.fn().mockResolvedValue({
              status: { available: true, source: 'global' },
            }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockUser),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionSchedulerService>(
      SubscriptionSchedulerService,
    );
    subscriptionsService = module.get(SubscriptionsService);
    reportGenerator = module.get(ReportGeneratorService);
    mailService = module.get(MailService);
    smtpService = module.get(SmtpService);
    usersService = module.get(UsersService);
    auditService = module.get(AuditService);
  });

  describe('processScheduledReports', () => {
    it('should find and process all due subscriptions', async () => {
      await service.processScheduledReports();

      expect(subscriptionsService.findDue).toHaveBeenCalled();
    });

    it('should send report for each subscription', async () => {
      await service.processScheduledReports();

      expect(reportGenerator.generate).toHaveBeenCalledWith(mockSubscription);
      expect(reportGenerator.renderEmail).toHaveBeenCalled();
      expect(mailService.sendReport).toHaveBeenCalledWith(
        'ws-123',
        'test@example.com',
        expect.stringContaining('Daily Report'),
        '<html>Report</html>',
      );
    });

    it('should mark subscription as sent on success', async () => {
      await service.processScheduledReports();

      expect(subscriptionsService.markSent).toHaveBeenCalledWith('sub-123');
    });

    it('should mark subscription as failed on error', async () => {
      reportGenerator.generate.mockRejectedValueOnce(
        new Error('Analytics error'),
      );

      await service.processScheduledReports();

      expect(subscriptionsService.markFailed).toHaveBeenCalledWith(
        'sub-123',
        'Analytics error',
      );
    });

    it('should log to audit_logs on success', async () => {
      await service.processScheduledReports();

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.report_sent',
          user_id: 'user-123',
          workspace_id: 'ws-123',
        }),
      );
    });

    it('should log to audit_logs on failure', async () => {
      reportGenerator.generate.mockRejectedValueOnce(new Error('Test error'));

      await service.processScheduledReports();

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.report_failed',
          user_id: 'user-123',
          workspace_id: 'ws-123',
        }),
      );
    });

    it('should continue processing other subscriptions if one fails', async () => {
      const subscription2: Subscription = {
        ...mockSubscription,
        id: 'sub-456',
      };
      subscriptionsService.findDue.mockResolvedValue([
        mockSubscription,
        subscription2,
      ]);
      reportGenerator.generate
        .mockRejectedValueOnce(new Error('First failed'))
        .mockResolvedValueOnce(mockReportData);

      await service.processScheduledReports();

      // Should attempt both subscriptions
      expect(reportGenerator.generate).toHaveBeenCalledTimes(2);
      // First should be marked as failed
      expect(subscriptionsService.markFailed).toHaveBeenCalledWith(
        'sub-123',
        'First failed',
      );
      // Second should be marked as sent
      expect(subscriptionsService.markSent).toHaveBeenCalledWith('sub-456');
    });

    it('should not send if user email not found', async () => {
      usersService.findById.mockResolvedValueOnce(null);

      await service.processScheduledReports();

      expect(mailService.sendReport).not.toHaveBeenCalled();
      expect(subscriptionsService.markFailed).toHaveBeenCalledWith(
        'sub-123',
        expect.stringContaining('User not found'),
      );
    });

    describe('race condition prevention', () => {
      it('should skip subscription if already processed (not found on re-fetch)', async () => {
        // First call returns subscription, re-fetch returns null (already processed)
        subscriptionsService.getById.mockResolvedValueOnce(null);

        await service.processScheduledReports();

        expect(reportGenerator.generate).not.toHaveBeenCalled();
        expect(mailService.sendReport).not.toHaveBeenCalled();
        expect(subscriptionsService.markSent).not.toHaveBeenCalled();
      });

      it('should skip if next_send_at no longer matches', async () => {
        const staleNextSendAt = mockSubscription.next_send_at;
        const freshSubscription = {
          ...mockSubscription,
          next_send_at: '2024-02-01T08:00:00.000Z', // Different from original
        };

        subscriptionsService.getById.mockResolvedValueOnce(freshSubscription);

        await service.processScheduledReports();

        expect(mailService.sendReport).not.toHaveBeenCalled();
        expect(subscriptionsService.markSent).not.toHaveBeenCalled();
      });

      it('should skip if status changed to paused', async () => {
        const pausedSubscription = {
          ...mockSubscription,
          status: 'paused' as const,
        };

        subscriptionsService.getById.mockResolvedValueOnce(pausedSubscription);

        await service.processScheduledReports();

        expect(mailService.sendReport).not.toHaveBeenCalled();
        expect(subscriptionsService.markSent).not.toHaveBeenCalled();
      });

      it('should process if subscription state unchanged', async () => {
        subscriptionsService.getById.mockResolvedValueOnce(mockSubscription);

        await service.processScheduledReports();

        expect(reportGenerator.generate).toHaveBeenCalled();
        expect(mailService.sendReport).toHaveBeenCalled();
      });
    });

    describe('email validation', () => {
      it('should fail gracefully when user has empty email', async () => {
        subscriptionsService.getById.mockResolvedValueOnce(mockSubscription);
        usersService.findById.mockResolvedValueOnce({
          ...mockUser,
          email: '',
        });

        await service.processScheduledReports();

        expect(mailService.sendReport).not.toHaveBeenCalled();
        expect(subscriptionsService.markFailed).toHaveBeenCalledWith(
          'sub-123',
          expect.stringContaining('no email'),
        );
      });

      it('should fail gracefully when user email is null', async () => {
        subscriptionsService.getById.mockResolvedValueOnce(mockSubscription);
        usersService.findById.mockResolvedValueOnce({
          ...mockUser,
          email: null as unknown as string,
        });

        await service.processScheduledReports();

        expect(mailService.sendReport).not.toHaveBeenCalled();
        expect(subscriptionsService.markFailed).toHaveBeenCalledWith(
          'sub-123',
          expect.stringContaining('no email'),
        );
      });
    });

    describe('SMTP validation', () => {
      it('should fail if SMTP is not configured', async () => {
        subscriptionsService.getById.mockResolvedValueOnce(mockSubscription);
        smtpService.getInfo.mockResolvedValueOnce({
          status: { available: false, source: 'none' },
          settings: null,
        });

        await service.processScheduledReports();

        expect(reportGenerator.generate).not.toHaveBeenCalled();
        expect(mailService.sendReport).not.toHaveBeenCalled();
        expect(subscriptionsService.markFailed).toHaveBeenCalledWith(
          'sub-123',
          expect.stringContaining('SMTP not configured'),
        );
      });

      it('should proceed if workspace SMTP is configured', async () => {
        subscriptionsService.getById.mockResolvedValueOnce(mockSubscription);
        smtpService.getInfo.mockResolvedValueOnce({
          status: {
            available: true,
            source: 'workspace',
            from_email: 'test@workspace.com',
          },
          settings: null,
        });

        await service.processScheduledReports();

        expect(reportGenerator.generate).toHaveBeenCalled();
        expect(mailService.sendReport).toHaveBeenCalled();
      });

      it('should proceed if global SMTP is configured', async () => {
        subscriptionsService.getById.mockResolvedValueOnce(mockSubscription);
        smtpService.getInfo.mockResolvedValueOnce({
          status: {
            available: true,
            source: 'global',
            from_email: 'noreply@staminads.com',
          },
          settings: null,
        });

        await service.processScheduledReports();

        expect(reportGenerator.generate).toHaveBeenCalled();
        expect(mailService.sendReport).toHaveBeenCalled();
      });
    });
  });
});
