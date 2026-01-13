import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { SubscriptionsService } from './subscriptions.service';
import { ReportGeneratorService } from './report/report-generator.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { PreviewSubscriptionDto } from './dto/preview-subscription.dto';
import { Subscription } from './entities/subscription.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('subscriptions')
@Controller('api')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly reportGenerator: ReportGeneratorService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('subscriptions.list')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'List user subscriptions for a workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Array of subscription objects' })
  async list(@Query('workspace_id') workspaceId: string, @Req() req: any) {
    return this.subscriptionsService.list(workspaceId, req.user.id);
  }

  @Get('subscriptions.get')
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Get a single subscription' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Subscription object' })
  @ApiResponse({ status: 400, description: 'Subscription not found' })
  async get(@Query('id') id: string, @Req() req: any) {
    const subscription = await this.subscriptionsService.get(id, req.user.id);
    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }
    return subscription;
  }

  @Post('subscriptions.create')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Create a new subscription' })
  @ApiResponse({ status: 201, description: 'Created subscription object' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const subscription = await this.subscriptionsService.create(
      dto,
      req.user.id,
    );

    await this.auditService.log({
      action: 'subscription.created',
      user_id: req.user.id,
      workspace_id: dto.workspace_id,
      target_type: 'subscription',
      target_id: subscription.id,
      metadata: { name: dto.name, frequency: dto.frequency },
    });

    return subscription;
  }

  @Post('subscriptions.update')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Update a subscription' })
  @ApiResponse({ status: 200, description: 'Updated subscription object' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async update(@Body() dto: UpdateSubscriptionDto, @Req() req: any) {
    const subscription = await this.subscriptionsService.update(
      dto,
      req.user.id,
    );

    await this.auditService.log({
      action: 'subscription.updated',
      user_id: req.user.id,
      workspace_id: dto.workspace_id,
      target_type: 'subscription',
      target_id: subscription.id,
      metadata: dto as unknown as Record<string, unknown>,
    });

    return subscription;
  }

  @Post('subscriptions.delete')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Delete a subscription' })
  @ApiBody({
    schema: {
      properties: { workspace_id: { type: 'string' }, id: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Success response' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async delete(
    @Body('workspace_id') workspaceId: string,
    @Body('id') id: string,
    @Req() req: any,
  ) {
    await this.subscriptionsService.delete(id, req.user.id);

    await this.auditService.log({
      action: 'subscription.deleted',
      user_id: req.user.id,
      workspace_id: workspaceId,
      target_type: 'subscription',
      target_id: id,
    });

    return { success: true };
  }

  @Post('subscriptions.pause')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Pause a subscription' })
  @ApiBody({
    schema: {
      properties: { workspace_id: { type: 'string' }, id: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Paused subscription object' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async pause(
    @Body('workspace_id') workspaceId: string,
    @Body('id') id: string,
    @Req() req: any,
  ) {
    const subscription = await this.subscriptionsService.pause(id, req.user.id);

    await this.auditService.log({
      action: 'subscription.paused',
      user_id: req.user.id,
      workspace_id: workspaceId,
      target_type: 'subscription',
      target_id: id,
    });

    return subscription;
  }

  @Post('subscriptions.resume')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Resume a paused subscription' })
  @ApiBody({
    schema: {
      properties: { workspace_id: { type: 'string' }, id: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Resumed subscription object' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async resume(
    @Body('workspace_id') workspaceId: string,
    @Body('id') id: string,
    @Req() req: any,
  ) {
    const subscription = await this.subscriptionsService.resume(
      id,
      req.user.id,
    );

    await this.auditService.log({
      action: 'subscription.resumed',
      user_id: req.user.id,
      workspace_id: workspaceId,
      target_type: 'subscription',
      target_id: id,
    });

    return subscription;
  }

  @Post('subscriptions.sendNow')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Send report immediately for testing' })
  @ApiBody({
    schema: {
      properties: { workspace_id: { type: 'string' }, id: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Success response' })
  @ApiResponse({ status: 400, description: 'Subscription or user not found' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async sendNow(
    @Body('workspace_id') workspaceId: string,
    @Body('id') id: string,
    @Req() req: any,
  ) {
    const subscription = await this.subscriptionsService.get(id, req.user.id);
    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }

    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Generate and send report
    const reportData = await this.reportGenerator.generate(subscription);
    const html = this.reportGenerator.renderEmail(reportData, subscription);
    const subject = `${subscription.name} - ${reportData.dateRangeLabel}`;

    await this.mailService.sendReport(
      subscription.workspace_id,
      user.email,
      subject,
      html,
    );

    // Mark as sent
    await this.subscriptionsService.markSent(subscription.id);

    await this.auditService.log({
      action: 'subscription.report_sent',
      user_id: req.user.id,
      workspace_id: workspaceId,
      target_type: 'subscription',
      target_id: id,
      metadata: { manual: true },
    });

    return { success: true };
  }

  @Post('subscriptions.preview')
  @UseGuards(WorkspaceAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Preview subscription report as HTML' })
  @ApiResponse({ status: 200, description: 'HTML email content' })
  @ApiResponse({ status: 403, description: 'Not a workspace member' })
  async preview(
    @Body() dto: PreviewSubscriptionDto,
    @Req() req: any,
  ): Promise<{ html: string }> {
    // Build a temporary subscription object for the report generator
    const tempSubscription: Subscription = {
      id: 'preview',
      user_id: req.user.id,
      workspace_id: dto.workspace_id,
      name: dto.name,
      frequency: dto.frequency,
      day_of_week: dto.day_of_week,
      day_of_month: dto.day_of_month,
      hour: 8,
      timezone: 'UTC',
      metrics: dto.metrics,
      dimensions: dto.dimensions ?? [],
      filters: JSON.stringify(dto.filters ?? []),
      limit: dto.limit ?? 10,
      status: 'active',
      last_send_status: 'pending',
      last_error: '',
      consecutive_failures: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const reportData = await this.reportGenerator.generate(tempSubscription);
    const html = this.reportGenerator.renderEmail(reportData, tempSubscription);
    return { html };
  }

  @Get('subscriptions.unsubscribe')
  @Public()
  @ApiOperation({ summary: 'Unsubscribe via signed token' })
  @ApiQuery({ name: 'token', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Success message' })
  @ApiResponse({
    status: 400,
    description: 'Invalid token or subscription not found',
  })
  @ApiResponse({ status: 401, description: 'Expired token' })
  async unsubscribe(@Query('token') token: string) {
    try {
      const payload = this.jwtService.verify(token);

      if (payload.action !== 'unsubscribe' || !payload.sub) {
        throw new BadRequestException('Invalid unsubscribe token');
      }

      const subscription = await this.subscriptionsService.getById(payload.sub);
      if (!subscription) {
        throw new BadRequestException('Subscription not found');
      }

      // Pause the subscription
      await this.subscriptionsService.pause(
        subscription.id,
        subscription.user_id,
      );

      await this.auditService.log({
        action: 'subscription.unsubscribed',
        user_id: subscription.user_id,
        workspace_id: subscription.workspace_id,
        target_type: 'subscription',
        target_id: subscription.id,
        metadata: { via: 'email_link' },
      });

      return { success: true, message: 'Successfully unsubscribed' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
