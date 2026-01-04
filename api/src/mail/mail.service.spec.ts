import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MailService, SendEmailOptions } from './mail.service';
import { SmtpService, SmtpConfig } from '../smtp/smtp.service';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

// Mock bcrypt (required by crypto module)
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

// Mock crypto module (required by SmtpService dependencies)
jest.mock('../common/crypto');

// Mock nodemailer
jest.mock('nodemailer');

// Mock file system to avoid actual file reads
jest.mock('fs');

// Mock Handlebars compilation
jest.mock('handlebars', () => ({
  compile: jest.fn((template: string) => {
    return jest.fn((data: any) => {
      // Simple template replacement for testing
      let result = template;
      Object.keys(data).forEach((key) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, data[key] || '');
      });
      return result;
    });
  }),
}));

describe('MailService', () => {
  let service: MailService;
  let smtpService: jest.Mocked<SmtpService>;
  let mockTransporter: any;

  const mockSmtpConfig: SmtpConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: true,
    auth: {
      user: 'test@example.com',
      pass: 'password123',
    },
    from: {
      name: 'Staminads',
      email: 'noreply@staminads.com',
    },
  };

  beforeEach(async () => {
    // Setup mock transporter
    mockTransporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
    };

    // Mock nodemailer.createTransport
    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

    // Mock fs.readFileSync for template loading
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      const fileName = path.basename(filePath);
      if (fileName === 'base.html') {
        return '<html><body>{{content}}</body></html>';
      }
      if (fileName === 'invitation.html') {
        return '<p>{{inviter_name}} invited you to {{workspace_name}}</p>';
      }
      if (fileName === 'password-reset.html') {
        return '<p>Reset password for {{user_name}}: {{reset_url}}</p>';
      }
      if (fileName === 'welcome.html') {
        return '<p>Welcome {{user_name}} to {{workspace_name}}</p>';
      }
      return '';
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: SmtpService,
          useValue: {
            getConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    smtpService = module.get(SmtpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and template loading', () => {
    it('loads base template on initialization', () => {
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('base.html'),
        'utf-8',
      );
    });

    it('loads all email templates on initialization', () => {
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('invitation.html'),
        'utf-8',
      );
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('password-reset.html'),
        'utf-8',
      );
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('welcome.html'),
        'utf-8',
      );
    });
  });

  describe('send', () => {
    const mockSendOptions: SendEmailOptions = {
      workspaceId: 'workspace-123',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      template: 'invitation',
      variables: {
        inviter_name: 'John Doe',
        workspace_name: 'Test Workspace',
        role: 'Admin',
        invite_url: 'https://example.com/invite',
      },
    };

    it('throws BadRequestException when SMTP is not configured', async () => {
      smtpService.getConfig.mockResolvedValue(null);

      await expect(service.send(mockSendOptions)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.send(mockSendOptions)).rejects.toThrow(
        'SMTP not configured. Please configure SMTP settings or set global SMTP environment variables.',
      );
    });

    it('throws BadRequestException for unknown template', async () => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);

      const invalidOptions: SendEmailOptions = {
        ...mockSendOptions,
        template: 'non-existent' as any,
      };

      await expect(service.send(invalidOptions)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.send(invalidOptions)).rejects.toThrow(
        'Unknown email template: non-existent',
      );
    });

    it('creates transporter with correct SMTP config', async () => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);

      await service.send(mockSendOptions);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: mockSmtpConfig.host,
        port: mockSmtpConfig.port,
        secure: mockSmtpConfig.secure,
        auth: mockSmtpConfig.auth,
      });
    });

    it('sends email with correct from address', async () => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);

      await service.send(mockSendOptions);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Staminads" <noreply@staminads.com>',
        }),
      );
    });

    it('sends email with correct recipient', async () => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);

      await service.send(mockSendOptions);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'recipient@example.com',
        }),
      );
    });

    it('sends email with correct subject', async () => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);

      await service.send(mockSendOptions);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Test Subject',
        }),
      );
    });

    it('renders template with variables', async () => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);

      await service.send(mockSendOptions);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('John Doe'),
        }),
      );
    });

    it('uses workspace SMTP config when available', async () => {
      const workspaceSmtpConfig: SmtpConfig = {
        host: 'workspace.smtp.com',
        port: 465,
        secure: true,
        auth: {
          user: 'workspace@example.com',
          pass: 'workspace-pass',
        },
        from: {
          name: 'Custom Name',
          email: 'custom@example.com',
        },
      };

      smtpService.getConfig.mockResolvedValue(workspaceSmtpConfig);

      await service.send(mockSendOptions);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'workspace.smtp.com',
        port: 465,
        secure: true,
        auth: workspaceSmtpConfig.auth,
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Custom Name" <custom@example.com>',
        }),
      );
    });

    it('works with SMTP config without auth', async () => {
      const noAuthConfig: SmtpConfig = {
        host: 'smtp.example.com',
        port: 25,
        secure: false,
        from: {
          name: 'No Auth',
          email: 'noreply@example.com',
        },
      };

      smtpService.getConfig.mockResolvedValue(noAuthConfig);

      await service.send(mockSendOptions);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 25,
        secure: false,
        auth: undefined,
      });
    });
  });

  describe('sendInvitation', () => {
    const mockVariables = {
      inviterName: 'Alice',
      workspaceName: 'My Workspace',
      role: 'Editor',
      inviteUrl: 'https://app.staminads.com/invite/abc123',
      workspaceWebsite: 'https://example.com',
    };

    beforeEach(() => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);
    });

    it('sends invitation email with correct subject', async () => {
      await service.sendInvitation(
        'workspace-123',
        'newuser@example.com',
        mockVariables,
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "You've been invited to join My Workspace on Staminads",
        }),
      );
    });

    it('sends invitation email to correct recipient', async () => {
      await service.sendInvitation(
        'workspace-123',
        'newuser@example.com',
        mockVariables,
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newuser@example.com',
        }),
      );
    });

    it('uses invitation template', async () => {
      await service.sendInvitation(
        'workspace-123',
        'newuser@example.com',
        mockVariables,
      );

      expect(smtpService.getConfig).toHaveBeenCalledWith('workspace-123');
    });

    it('transforms variables to snake_case for template', async () => {
      jest.spyOn(service, 'send');

      await service.sendInvitation(
        'workspace-123',
        'newuser@example.com',
        mockVariables,
      );

      expect(service.send).toHaveBeenCalledWith({
        workspaceId: 'workspace-123',
        to: 'newuser@example.com',
        subject: "You've been invited to join My Workspace on Staminads",
        template: 'invitation',
        variables: {
          inviter_name: 'Alice',
          workspace_name: 'My Workspace',
          role: 'Editor',
          invite_url: 'https://app.staminads.com/invite/abc123',
          workspace_website: 'https://example.com',
        },
      });
    });

    it('handles missing optional workspaceWebsite', async () => {
      const { workspaceWebsite, ...requiredVariables } = mockVariables;
      jest.spyOn(service, 'send');

      await service.sendInvitation(
        'workspace-123',
        'newuser@example.com',
        requiredVariables,
      );

      expect(service.send).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            workspace_website: '',
          }),
        }),
      );
    });

    it('throws when SMTP is not configured', async () => {
      smtpService.getConfig.mockResolvedValue(null);

      await expect(
        service.sendInvitation(
          'workspace-123',
          'newuser@example.com',
          mockVariables,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendPasswordReset', () => {
    const mockVariables = {
      userName: 'Bob Smith',
      resetUrl: 'https://app.staminads.com/reset/xyz789',
    };

    beforeEach(() => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);
    });

    it('sends password reset email with correct subject', async () => {
      await service.sendPasswordReset(
        'workspace-123',
        'user@example.com',
        mockVariables,
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Reset your Staminads password',
        }),
      );
    });

    it('sends password reset email to correct recipient', async () => {
      await service.sendPasswordReset(
        'workspace-123',
        'user@example.com',
        mockVariables,
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
        }),
      );
    });

    it('uses password-reset template', async () => {
      jest.spyOn(service, 'send');

      await service.sendPasswordReset(
        'workspace-123',
        'user@example.com',
        mockVariables,
      );

      expect(service.send).toHaveBeenCalledWith({
        workspaceId: 'workspace-123',
        to: 'user@example.com',
        subject: 'Reset your Staminads password',
        template: 'password-reset',
        variables: {
          user_name: 'Bob Smith',
          reset_url: 'https://app.staminads.com/reset/xyz789',
        },
      });
    });

    it('transforms variables to snake_case for template', async () => {
      jest.spyOn(service, 'send');

      await service.sendPasswordReset(
        'workspace-123',
        'user@example.com',
        mockVariables,
      );

      expect(service.send).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            user_name: 'Bob Smith',
            reset_url: 'https://app.staminads.com/reset/xyz789',
          },
        }),
      );
    });

    it('throws when SMTP is not configured', async () => {
      smtpService.getConfig.mockResolvedValue(null);

      await expect(
        service.sendPasswordReset(
          'workspace-123',
          'user@example.com',
          mockVariables,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendWelcome', () => {
    const mockVariables = {
      userName: 'Charlie Brown',
      workspaceName: 'Charlie Workspace',
      role: 'Viewer',
      dashboardUrl: 'https://app.staminads.com/dashboard',
    };

    beforeEach(() => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);
    });

    it('sends welcome email with correct subject', async () => {
      await service.sendWelcome(
        'workspace-123',
        'charlie@example.com',
        mockVariables,
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Welcome to Charlie Workspace on Staminads',
        }),
      );
    });

    it('sends welcome email to correct recipient', async () => {
      await service.sendWelcome(
        'workspace-123',
        'charlie@example.com',
        mockVariables,
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'charlie@example.com',
        }),
      );
    });

    it('uses welcome template', async () => {
      jest.spyOn(service, 'send');

      await service.sendWelcome(
        'workspace-123',
        'charlie@example.com',
        mockVariables,
      );

      expect(service.send).toHaveBeenCalledWith({
        workspaceId: 'workspace-123',
        to: 'charlie@example.com',
        subject: 'Welcome to Charlie Workspace on Staminads',
        template: 'welcome',
        variables: {
          user_name: 'Charlie Brown',
          workspace_name: 'Charlie Workspace',
          role: 'Viewer',
          dashboard_url: 'https://app.staminads.com/dashboard',
        },
      });
    });

    it('transforms variables to snake_case for template', async () => {
      jest.spyOn(service, 'send');

      await service.sendWelcome(
        'workspace-123',
        'charlie@example.com',
        mockVariables,
      );

      expect(service.send).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            user_name: 'Charlie Brown',
            workspace_name: 'Charlie Workspace',
            role: 'Viewer',
            dashboard_url: 'https://app.staminads.com/dashboard',
          },
        }),
      );
    });

    it('throws when SMTP is not configured', async () => {
      smtpService.getConfig.mockResolvedValue(null);

      await expect(
        service.sendWelcome(
          'workspace-123',
          'charlie@example.com',
          mockVariables,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendTestEmail', () => {
    beforeEach(() => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);
    });

    it('sends test email with correct subject', async () => {
      await service.sendTestEmail('workspace-123', 'test@example.com');

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Staminads SMTP Test',
        }),
      );
    });

    it('sends test email to correct recipient', async () => {
      await service.sendTestEmail('workspace-123', 'test@example.com');

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
        }),
      );
    });

    it('includes SMTP configuration details in email body', async () => {
      await service.sendTestEmail('workspace-123', 'test@example.com');

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('SMTP Configuration Test'),
        }),
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('noreply@staminads.com'),
        }),
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('smtp.example.com:587'),
        }),
      );
    });

    it('uses correct from address', async () => {
      await service.sendTestEmail('workspace-123', 'test@example.com');

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Staminads" <noreply@staminads.com>',
        }),
      );
    });

    it('throws when SMTP is not configured', async () => {
      smtpService.getConfig.mockResolvedValue(null);

      await expect(
        service.sendTestEmail('workspace-123', 'test@example.com'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.sendTestEmail('workspace-123', 'test@example.com'),
      ).rejects.toThrow('SMTP not configured');
    });

    it('creates transporter with workspace SMTP config', async () => {
      const workspaceConfig: SmtpConfig = {
        host: 'custom.smtp.com',
        port: 465,
        secure: true,
        auth: {
          user: 'custom@example.com',
          pass: 'custom-pass',
        },
        from: {
          name: 'Custom',
          email: 'custom@example.com',
        },
      };

      smtpService.getConfig.mockResolvedValue(workspaceConfig);

      await service.sendTestEmail('workspace-123', 'test@example.com');

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'custom.smtp.com',
        port: 465,
        secure: true,
        auth: workspaceConfig.auth,
      });
    });
  });

  describe('createTransporter', () => {
    it('creates transporter with full auth config', () => {
      const config: SmtpConfig = {
        host: 'smtp.test.com',
        port: 587,
        secure: true,
        auth: {
          user: 'user@test.com',
          pass: 'password',
        },
        from: {
          name: 'Test',
          email: 'test@test.com',
        },
      };

      service['createTransporter'](config);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.test.com',
        port: 587,
        secure: true,
        auth: {
          user: 'user@test.com',
          pass: 'password',
        },
      });
    });

    it('creates transporter without auth', () => {
      const config: SmtpConfig = {
        host: 'smtp.test.com',
        port: 25,
        secure: false,
        from: {
          name: 'Test',
          email: 'test@test.com',
        },
      };

      service['createTransporter'](config);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.test.com',
        port: 25,
        secure: false,
        auth: undefined,
      });
    });

    it('creates transporter with non-secure connection', () => {
      const config: SmtpConfig = {
        host: 'smtp.test.com',
        port: 25,
        secure: false,
        auth: {
          user: 'user@test.com',
          pass: 'password',
        },
        from: {
          name: 'Test',
          email: 'test@test.com',
        },
      };

      service['createTransporter'](config);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.test.com',
        port: 25,
        secure: false,
        auth: config.auth,
      });
    });
  });

  describe('template rendering', () => {
    beforeEach(() => {
      smtpService.getConfig.mockResolvedValue(mockSmtpConfig);
    });

    it('wraps content template in base template', async () => {
      await service.send({
        workspaceId: 'workspace-123',
        to: 'test@example.com',
        subject: 'Test',
        template: 'invitation',
        variables: {
          inviter_name: 'John',
          workspace_name: 'Workspace',
          role: 'Admin',
          invite_url: 'https://example.com',
        },
      });

      const callArgs = mockTransporter.sendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('<html>');
      expect(callArgs.html).toContain('<body>');
    });

    it('passes variables to both content and base templates', async () => {
      await service.send({
        workspaceId: 'workspace-123',
        to: 'test@example.com',
        subject: 'Test',
        template: 'invitation',
        variables: {
          inviter_name: 'John Doe',
          workspace_name: 'My Workspace',
          role: 'Editor',
          invite_url: 'https://example.com/invite',
        },
      });

      const callArgs = mockTransporter.sendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('John Doe');
      expect(callArgs.html).toContain('My Workspace');
    });
  });

  describe('SMTP configuration fallback', () => {
    it('uses workspace SMTP config when available', async () => {
      const workspaceConfig: SmtpConfig = {
        host: 'workspace.smtp.com',
        port: 465,
        secure: true,
        auth: {
          user: 'workspace@example.com',
          pass: 'workspace-pass',
        },
        from: {
          name: 'Workspace',
          email: 'workspace@example.com',
        },
      };

      smtpService.getConfig.mockResolvedValue(workspaceConfig);

      await service.send({
        workspaceId: 'workspace-123',
        to: 'test@example.com',
        subject: 'Test',
        template: 'invitation',
        variables: {},
      });

      expect(smtpService.getConfig).toHaveBeenCalledWith('workspace-123');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'workspace.smtp.com',
          port: 465,
        }),
      );
    });

    it('falls back to global SMTP when workspace config is null', async () => {
      smtpService.getConfig.mockResolvedValue(null);

      await expect(
        service.send({
          workspaceId: 'workspace-123',
          to: 'test@example.com',
          subject: 'Test',
          template: 'invitation',
          variables: {},
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
