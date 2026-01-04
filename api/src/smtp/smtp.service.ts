import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SmtpSettingsDto } from './dto/smtp-settings.dto';
import { encryptPassword, decryptPassword } from '../common/crypto';

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

export interface SmtpInfo {
  status: SmtpStatus;
  settings: {
    enabled: boolean;
    host: string;
    port: number;
    username?: string;
    password?: string;
    from_name: string;
    from_email: string;
  } | null;
}

@Injectable()
export class SmtpService {
  constructor(
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  /**
   * Get SMTP info (status + settings) in a single query
   */
  async getInfo(workspaceId: string): Promise<SmtpInfo> {
    const workspace = await this.workspacesService.get(workspaceId);
    const smtp = workspace?.settings?.smtp;

    // Build settings (if workspace has SMTP configured)
    const settings = smtp
      ? {
          enabled: smtp.enabled,
          host: smtp.host,
          port: smtp.port,
          username: smtp.username,
          password: smtp.password_encrypted ? '********' : undefined,
          from_name: smtp.from_name,
          from_email: smtp.from_email,
        }
      : null;

    // Build status
    let status: SmtpStatus;
    if (smtp?.enabled) {
      status = {
        available: true,
        source: 'workspace',
        from_email: smtp.from_email,
      };
    } else {
      const globalSmtp = this.getGlobalConfig();
      if (globalSmtp) {
        status = {
          available: true,
          source: 'global',
          from_email: globalSmtp.from.email,
        };
      } else {
        status = {
          available: false,
          source: 'none',
        };
      }
    }

    return { status, settings };
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

    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    // Encrypt password if provided
    let passwordEncrypted: string | undefined;
    if (dto.password && dto.password !== '********') {
      passwordEncrypted = encryptPassword(
        dto.password,
        encryptionKey,
        workspaceId,
      );
    } else if (dto.password === '********') {
      // Keep existing password
      passwordEncrypted = workspace.settings?.smtp?.password_encrypted;
    }

    const smtpSettings = {
      enabled: dto.enabled,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      password_encrypted: passwordEncrypted,
      from_name: dto.from_name,
      from_email: dto.from_email,
    };

    await this.workspacesService.update({
      id: workspaceId,
      settings: {
        ...workspace.settings,
        custom_dimensions: workspace.settings.custom_dimensions || undefined,
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
    await this.workspacesService.update({
      id: workspaceId,
      settings: {
        ...restSettings,
        custom_dimensions: restSettings.custom_dimensions || undefined,
      },
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
      const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY not configured');
      }

      // Port 465 uses implicit TLS, other ports use STARTTLS (auto-upgrade)
      const secure = smtp.port === 465;

      return {
        host: smtp.host,
        port: smtp.port,
        secure,
        auth: smtp.username
          ? {
              user: smtp.username,
              pass: smtp.password_encrypted
                ? decryptPassword(
                    smtp.password_encrypted,
                    encryptionKey,
                    workspaceId,
                  )
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

    const port = this.configService.get<number>('SMTP_PORT', 587);
    // Port 465 uses implicit TLS, other ports use STARTTLS (auto-upgrade)
    const secure = port === 465;

    return {
      host,
      port,
      secure,
      auth: this.configService.get<string>('SMTP_USER')
        ? {
            user: this.configService.get<string>('SMTP_USER')!,
            pass: this.configService.get<string>('SMTP_PASSWORD', ''),
          }
        : undefined,
      from: {
        name: this.configService.get<string>('SMTP_FROM_NAME', 'Staminads'),
        email: this.configService.get<string>(
          'SMTP_FROM_EMAIL',
          'noreply@staminads.com',
        ),
      },
    };
  }
}
