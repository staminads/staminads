# Track B: SMTP/Mail Module Implementation Plan

**Track:** B - SMTP/Mail Module
**Dependencies:** Phase 0 (Foundation)
**Blocks:** Track D (Invitations)

---

## Overview

The SMTP/Mail module handles email configuration and sending. It supports both global (environment-based) and per-workspace SMTP settings, with priority given to workspace-level configuration.

---

## Files to Create

```
api/src/smtp/
├── smtp.module.ts
├── smtp.service.ts
├── smtp.controller.ts
├── smtp.service.spec.ts
└── dto/
    ├── smtp-settings.dto.ts
    └── test-smtp.dto.ts

api/src/mail/
├── mail.module.ts
├── mail.service.ts
├── mail.service.spec.ts
└── templates/
    ├── base.html
    ├── invitation.html
    ├── password-reset.html
    └── welcome.html
```

---

## Task 1: SMTP Settings DTO

**File:** `api/src/smtp/dto/smtp-settings.dto.ts`

```typescript
import {
  IsBoolean,
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

export class SmtpSettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @IsBoolean()
  tls: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  from_name: string;

  @IsEmail()
  from_email: string;
}

export class TestSmtpDto {
  @IsEmail()
  to: string;
}
```

---

## Task 2: SMTP Service

**File:** `api/src/smtp/smtp.service.ts`

```typescript
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SmtpSettingsDto } from './dto/smtp-settings.dto';
import { encrypt, decrypt } from '../common/crypto';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: {
    name: string;
    email: string;
  };
}

export interface SmtpStatus {
  available: boolean;
  source: 'workspace' | 'global' | 'none';
  from_email?: string;
}

@Injectable()
export class SmtpService {
  constructor(
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  /**
   * Get SMTP status for a workspace
   */
  async getStatus(workspaceId: string): Promise<SmtpStatus> {
    // Check workspace SMTP first
    const workspace = await this.workspacesService.get(workspaceId);
    if (workspace?.settings?.smtp?.enabled) {
      return {
        available: true,
        source: 'workspace',
        from_email: workspace.settings.smtp.from_email,
      };
    }

    // Fall back to global SMTP
    const globalSmtp = this.getGlobalConfig();
    if (globalSmtp) {
      return {
        available: true,
        source: 'global',
        from_email: globalSmtp.from.email,
      };
    }

    return {
      available: false,
      source: 'none',
    };
  }

  /**
   * Get SMTP settings for a workspace (owner only)
   */
  async getSettings(workspaceId: string): Promise<SmtpSettingsDto | null> {
    const workspace = await this.workspacesService.get(workspaceId);
    if (!workspace?.settings?.smtp) {
      return null;
    }

    const smtp = workspace.settings.smtp;
    return {
      enabled: smtp.enabled,
      host: smtp.host,
      port: smtp.port,
      tls: smtp.tls,
      username: smtp.username,
      password: smtp.password_encrypted ? '********' : undefined, // Mask password
      from_name: smtp.from_name,
      from_email: smtp.from_email,
    };
  }

  /**
   * Update SMTP settings for a workspace
   */
  async updateSettings(
    workspaceId: string,
    dto: SmtpSettingsDto,
  ): Promise<SmtpSettingsDto> {
    const workspace = await this.workspacesService.get(workspaceId);
    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }

    // Encrypt password if provided
    let passwordEncrypted: string | undefined;
    if (dto.password && dto.password !== '********') {
      passwordEncrypted = encrypt(dto.password, workspaceId);
    } else if (dto.password === '********') {
      // Keep existing password
      passwordEncrypted = workspace.settings?.smtp?.password_encrypted;
    }

    const smtpSettings = {
      enabled: dto.enabled,
      host: dto.host,
      port: dto.port,
      tls: dto.tls,
      username: dto.username,
      password_encrypted: passwordEncrypted,
      from_name: dto.from_name,
      from_email: dto.from_email,
    };

    await this.workspacesService.update(workspaceId, {
      settings: {
        ...workspace.settings,
        smtp: smtpSettings,
      },
    });

    return {
      ...dto,
      password: passwordEncrypted ? '********' : undefined,
    };
  }

  /**
   * Delete workspace SMTP settings (fall back to global)
   */
  async deleteSettings(workspaceId: string): Promise<void> {
    const workspace = await this.workspacesService.get(workspaceId);
    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }

    const { smtp, ...restSettings } = workspace.settings || {};
    await this.workspacesService.update(workspaceId, {
      settings: restSettings,
    });
  }

  /**
   * Get effective SMTP config for sending emails
   */
  async getConfig(workspaceId: string): Promise<SmtpConfig | null> {
    // Try workspace SMTP first
    const workspace = await this.workspacesService.get(workspaceId);
    if (workspace?.settings?.smtp?.enabled) {
      const smtp = workspace.settings.smtp;
      return {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.tls,
        auth: smtp.username
          ? {
              user: smtp.username,
              pass: smtp.password_encrypted
                ? decrypt(smtp.password_encrypted, workspaceId)
                : '',
            }
          : undefined,
        from: {
          name: smtp.from_name,
          email: smtp.from_email,
        },
      };
    }

    // Fall back to global
    return this.getGlobalConfig();
  }

  /**
   * Get global SMTP config from environment
   */
  private getGlobalConfig(): SmtpConfig | null {
    const host = this.configService.get<string>('SMTP_HOST');
    if (!host) {
      return null;
    }

    return {
      host,
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<boolean>('SMTP_TLS', true),
      auth: this.configService.get<string>('SMTP_USER')
        ? {
            user: this.configService.get<string>('SMTP_USER')!,
            pass: this.configService.get<string>('SMTP_PASSWORD', ''),
          }
        : undefined,
      from: {
        name: this.configService.get<string>('SMTP_FROM_NAME', 'Staminads'),
        email: this.configService.get<string>('SMTP_FROM_EMAIL', 'noreply@staminads.com'),
      },
    };
  }
}
```

---

## Task 3: SMTP Controller

**File:** `api/src/smtp/smtp.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SmtpService, SmtpStatus } from './smtp.service';
import { MailService } from '../mail/mail.service';
import { SmtpSettingsDto, TestSmtpDto } from './dto/smtp-settings.dto';

@ApiTags('smtp')
@ApiSecurity('jwt-auth')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class SmtpController {
  constructor(
    private readonly smtpService: SmtpService,
    private readonly mailService: MailService,
  ) {}

  @Get('smtp.status')
  @ApiOperation({ summary: 'Check if SMTP is available' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'SMTP status' })
  async status(@Query('workspaceId') workspaceId: string): Promise<SmtpStatus> {
    return this.smtpService.getStatus(workspaceId);
  }

  @Get('smtp.get')
  @ApiOperation({ summary: 'Get SMTP settings (owner only)' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'SMTP settings' })
  async get(
    @Query('workspaceId') workspaceId: string,
  ): Promise<SmtpSettingsDto | null> {
    // TODO: Check user is workspace owner
    return this.smtpService.getSettings(workspaceId);
  }

  @Post('smtp.update')
  @ApiOperation({ summary: 'Update SMTP settings (owner only)' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Updated SMTP settings' })
  async update(
    @Query('workspaceId') workspaceId: string,
    @Body() dto: SmtpSettingsDto,
  ): Promise<SmtpSettingsDto> {
    // TODO: Check user is workspace owner
    return this.smtpService.updateSettings(workspaceId, dto);
  }

  @Post('smtp.delete')
  @ApiOperation({ summary: 'Remove workspace SMTP (fall back to global)' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'SMTP settings removed' })
  async delete(
    @Query('workspaceId') workspaceId: string,
  ): Promise<{ success: boolean }> {
    // TODO: Check user is workspace owner
    await this.smtpService.deleteSettings(workspaceId);
    return { success: true };
  }

  @Post('smtp.test')
  @ApiOperation({ summary: 'Send test email' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Test email sent' })
  async test(
    @Query('workspaceId') workspaceId: string,
    @Body() dto: TestSmtpDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.mailService.sendTestEmail(workspaceId, dto.to);
      return { success: true, message: 'Test email sent successfully' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }
}
```

---

## Task 4: SMTP Module

**File:** `api/src/smtp/smtp.module.ts`

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmtpService } from './smtp.service';
import { SmtpController } from './smtp.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    ConfigModule,
    WorkspacesModule,
    forwardRef(() => MailModule),
  ],
  controllers: [SmtpController],
  providers: [SmtpService],
  exports: [SmtpService],
})
export class SmtpModule {}
```

---

## Task 5: Mail Service

**File:** `api/src/mail/mail.service.ts`

```typescript
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
      throw new BadRequestException(`Unknown email template: ${options.template}`);
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
```

---

## Task 6: Mail Module

**File:** `api/src/mail/mail.module.ts`

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmtpModule } from '../smtp/smtp.module';

@Module({
  imports: [forwardRef(() => SmtpModule)],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
```

---

## Task 7: Email Templates

### 7.1 Base Template

**File:** `api/src/mail/templates/base.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Staminads</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .button {
      display: inline-block;
      background-color: #7763f1;
      color: white !important;
      text-decoration: none;
      padding: 12px 32px;
      border-radius: 6px;
      font-weight: 500;
      margin: 20px 0;
    }
    .button:hover {
      background-color: #6654d6;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      color: #666;
      font-size: 14px;
    }
    h1 {
      color: #1a1a1a;
      margin-top: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      {{{content}}}
    </div>
    <div class="footer">
      <p>Staminads Analytics</p>
      {{#if workspace_website}}
      <p>{{workspace_website}}</p>
      {{/if}}
    </div>
  </div>
</body>
</html>
```

### 7.2 Invitation Template

**File:** `api/src/mail/templates/invitation.html`

```html
<p>Hi,</p>

<p><strong>{{inviter_name}}</strong> has invited you to join <strong>{{workspace_name}}</strong> as <strong>{{role}}</strong> on Staminads.</p>

<p style="text-align: center;">
  <a href="{{invite_url}}" class="button">Accept Invitation</a>
</p>

<p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>

<p style="color: #666; font-size: 14px;">If you didn't expect this invitation, you can ignore this email.</p>
```

### 7.3 Password Reset Template

**File:** `api/src/mail/templates/password-reset.html`

```html
<p>Hi {{user_name}},</p>

<p>We received a request to reset your password. Click the button below to choose a new password:</p>

<p style="text-align: center;">
  <a href="{{reset_url}}" class="button">Reset Password</a>
</p>

<p style="color: #666; font-size: 14px;">This link expires in 1 hour.</p>

<p style="color: #666; font-size: 14px;">If you didn't request this, you can ignore this email. Your password won't be changed.</p>
```

### 7.4 Welcome Template

**File:** `api/src/mail/templates/welcome.html`

```html
<p>Hi {{user_name}},</p>

<p>You've successfully joined <strong>{{workspace_name}}</strong> as <strong>{{role}}</strong>.</p>

<p style="text-align: center;">
  <a href="{{dashboard_url}}" class="button">Go to Dashboard</a>
</p>

<p>Welcome to the team!</p>
```

---

## Task 8: Add Encryption Helpers

**File:** `api/src/common/crypto.ts` (add to existing)

```typescript
import * as crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!';
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a string using AES-256-GCM
 */
export function encrypt(text: string, context: string): string {
  const iv = crypto.randomBytes(12);
  const key = crypto
    .createHash('sha256')
    .update(ENCRYPTION_KEY + context)
    .digest();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string using AES-256-GCM
 */
export function decrypt(encryptedText: string, context: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto
    .createHash('sha256')
    .update(ENCRYPTION_KEY + context)
    .digest();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

---

## Task 9: Install Dependencies

```bash
cd api
npm install nodemailer handlebars
npm install -D @types/nodemailer
```

---

## Deliverables Checklist

- [ ] `api/src/smtp/smtp.module.ts`
- [ ] `api/src/smtp/smtp.service.ts`
- [ ] `api/src/smtp/smtp.controller.ts`
- [ ] `api/src/smtp/dto/smtp-settings.dto.ts`
- [ ] `api/src/mail/mail.module.ts`
- [ ] `api/src/mail/mail.service.ts`
- [ ] `api/src/mail/templates/base.html`
- [ ] `api/src/mail/templates/invitation.html`
- [ ] `api/src/mail/templates/password-reset.html`
- [ ] `api/src/mail/templates/welcome.html`
- [ ] Encryption helpers in `crypto.ts`
- [ ] Dependencies installed (nodemailer, handlebars)
- [ ] Modules registered in `app.module.ts`
- [ ] Unit tests for services
- [ ] OpenAPI spec updated

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `smtp.status` | GET | Yes | Check SMTP availability |
| `smtp.get` | GET | Yes (owner) | Get SMTP settings |
| `smtp.update` | POST | Yes (owner) | Update SMTP settings |
| `smtp.delete` | POST | Yes (owner) | Remove workspace SMTP |
| `smtp.test` | POST | Yes (owner) | Send test email |

---

## Acceptance Criteria

1. Workspace owners can configure SMTP settings
2. SMTP passwords are encrypted before storage
3. API never exposes plain passwords (always masked)
4. Global SMTP works as fallback when workspace SMTP is not configured
5. `smtp.status` correctly reports the source (workspace/global/none)
6. Test email functionality works
7. All 3 email templates render correctly with variables
8. Emails are sent with correct from address and formatting
9. Template loading happens at startup (not per-request)
10. Error handling provides clear messages for SMTP failures

---

## Environment Variables

Add to `.env.example`:

```
# Encryption key for sensitive data (32 chars)
ENCRYPTION_KEY=your-32-character-encryption-key

# Global SMTP (optional fallback)
SMTP_HOST=
SMTP_PORT=587
SMTP_TLS=true
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_NAME=Staminads
SMTP_FROM_EMAIL=noreply@staminads.com
```
