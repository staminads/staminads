import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { SmtpService, SmtpInfo } from './smtp.service';
import { MailService } from '../mail/mail.service';
import {
  SmtpSettingsDto,
  UpdateSmtpDto,
  DeleteSmtpDto,
  TestSmtpDto,
} from './dto/smtp-settings.dto';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';

@ApiTags('smtp')
@ApiSecurity('jwt-auth')
@Controller('api')
export class SmtpController {
  constructor(
    private readonly smtpService: SmtpService,
    private readonly mailService: MailService,
  ) {}

  @Get('smtp.info')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Get SMTP status and settings' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'SMTP info (status + settings)' })
  async info(@Query('workspace_id') workspaceId: string): Promise<SmtpInfo> {
    return this.smtpService.getInfo(workspaceId);
  }

  @Post('smtp.update')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('workspace.smtp')
  @ApiOperation({ summary: 'Update SMTP settings (owner only)' })
  @ApiResponse({ status: 200, description: 'Updated SMTP settings' })
  async update(@Body() dto: UpdateSmtpDto): Promise<SmtpSettingsDto> {
    return this.smtpService.updateSettings(dto.workspace_id, dto);
  }

  @Post('smtp.delete')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('workspace.smtp')
  @ApiOperation({ summary: 'Remove workspace SMTP (fall back to global)' })
  @ApiResponse({ status: 200, description: 'SMTP settings removed' })
  async delete(@Body() dto: DeleteSmtpDto): Promise<{ success: boolean }> {
    await this.smtpService.deleteSettings(dto.workspace_id);
    return { success: true };
  }

  @Post('smtp.test')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Send test email' })
  @ApiResponse({ status: 200, description: 'Test email sent' })
  async test(
    @Body() dto: TestSmtpDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.mailService.sendTestEmail(dto.workspace_id, dto.to_email);
      return { success: true, message: 'Test email sent successfully' };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }
}
