import { Injectable, BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { SmtpService, SmtpConfig } from '../smtp/smtp.service';

export interface SendEmailOptions {
  workspaceId: string;
  to: string;
  subject: string;
  template: 'invitation' | 'password-reset' | 'welcome';
  variables: Record<string, string>;
}

@Injectable()
export class MailService {
  private templates: Map<string, Handlebars.TemplateDelegate> = new Map();
  private baseTemplate: Handlebars.TemplateDelegate;

  constructor(private readonly smtpService: SmtpService) {
    this.loadTemplates();
  }

  private loadTemplates(): void {
    const templatesDir = path.join(__dirname, 'templates');

    // Load base template
    const baseHtml = fs.readFileSync(
      path.join(templatesDir, 'base.html'),
      'utf-8',
    );
    this.baseTemplate = Handlebars.compile(baseHtml);

    // Load content templates
    const templateNames = ['invitation', 'password-reset', 'welcome'];
    for (const name of templateNames) {
      const html = fs.readFileSync(
        path.join(templatesDir, `${name}.html`),
        'utf-8',
      );
      this.templates.set(name, Handlebars.compile(html));
    }
  }

  /**
   * Send an email using the appropriate SMTP config
   */
  async send(options: SendEmailOptions): Promise<void> {
    const config = await this.smtpService.getConfig(options.workspaceId);
    if (!config) {
      throw new BadRequestException(
        'SMTP not configured. Please configure SMTP settings or set global SMTP environment variables.',
      );
    }

    const transporter = this.createTransporter(config);

    // Render template
    const contentTemplate = this.templates.get(options.template);
    if (!contentTemplate) {
      throw new BadRequestException(
        `Unknown email template: ${options.template}`,
      );
    }

    const content = contentTemplate(options.variables);
    const html = this.baseTemplate({
      content,
      ...options.variables,
    });

    await transporter.sendMail({
      from: `"${config.from.name}" <${config.from.email}>`,
      to: options.to,
      subject: options.subject,
      html,
    });
  }

  /**
   * Send invitation email
   */
  async sendInvitation(
    workspaceId: string,
    to: string,
    variables: {
      inviterName: string;
      workspaceName: string;
      role: string;
      inviteUrl: string;
      workspaceWebsite?: string;
    },
  ): Promise<void> {
    await this.send({
      workspaceId,
      to,
      subject: `You've been invited to join ${variables.workspaceName} on Staminads`,
      template: 'invitation',
      variables: {
        inviter_name: variables.inviterName,
        workspace_name: variables.workspaceName,
        role: variables.role,
        invite_url: variables.inviteUrl,
        workspace_website: variables.workspaceWebsite || '',
      },
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(
    workspaceId: string,
    to: string,
    variables: {
      userName: string;
      resetUrl: string;
    },
  ): Promise<void> {
    await this.send({
      workspaceId,
      to,
      subject: 'Reset your Staminads password',
      template: 'password-reset',
      variables: {
        user_name: variables.userName,
        reset_url: variables.resetUrl,
      },
    });
  }

  /**
   * Send welcome email after accepting invitation
   */
  async sendWelcome(
    workspaceId: string,
    to: string,
    variables: {
      userName: string;
      workspaceName: string;
      role: string;
      dashboardUrl: string;
    },
  ): Promise<void> {
    await this.send({
      workspaceId,
      to,
      subject: `Welcome to ${variables.workspaceName} on Staminads`,
      template: 'welcome',
      variables: {
        user_name: variables.userName,
        workspace_name: variables.workspaceName,
        role: variables.role,
        dashboard_url: variables.dashboardUrl,
      },
    });
  }

  /**
   * Send report email (pre-rendered HTML)
   */
  async sendReport(
    workspaceId: string,
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const config = await this.smtpService.getConfig(workspaceId);
    if (!config) {
      throw new BadRequestException(
        'SMTP not configured. Please configure SMTP settings or set global SMTP environment variables.',
      );
    }

    const transporter = this.createTransporter(config);

    await transporter.sendMail({
      from: `"${config.from.name}" <${config.from.email}>`,
      to,
      subject,
      html,
    });
  }

  /**
   * Send test email
   */
  async sendTestEmail(workspaceId: string, to: string): Promise<void> {
    const config = await this.smtpService.getConfig(workspaceId);
    if (!config) {
      throw new BadRequestException('SMTP not configured');
    }

    const transporter = this.createTransporter(config);

    await transporter.sendMail({
      from: `"${config.from.name}" <${config.from.email}>`,
      to,
      subject: 'Staminads SMTP Test',
      html: `
        <h1>SMTP Configuration Test</h1>
        <p>This is a test email from Staminads.</p>
        <p>If you received this email, your SMTP configuration is working correctly.</p>
        <p><strong>From:</strong> ${config.from.email}</p>
        <p><strong>Server:</strong> ${config.host}:${config.port}</p>
      `,
    });
  }

  private createTransporter(config: SmtpConfig): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }
}
