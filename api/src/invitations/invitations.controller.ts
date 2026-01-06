import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import {
  AcceptInvitationDto,
  InvitationDetailsDto,
} from './dto/accept-invitation.dto';
import { InvitationIdDto } from './dto/invitation-id.dto';
import { InvitationWithInviter } from '../common/entities';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';

@ApiTags('invitations')
@Controller('api')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get('invitations.list')
  @ApiSecurity('jwt-auth')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'List workspace invitations' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of pending invitations' })
  async list(
    @Query('workspaceId') workspaceId: string,
  ): Promise<InvitationWithInviter[]> {
    return this.invitationsService.list(workspaceId);
  }

  @Post('invitations.create')
  @DemoRestricted()
  @ApiSecurity('jwt-auth')
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('members.invite')
  @ApiOperation({ summary: 'Send invitation email' })
  @ApiResponse({
    status: 201,
    description: 'Invitation created and email sent',
  })
  async create(@Req() req: any, @Body() dto: CreateInvitationDto) {
    return this.invitationsService.create(dto, req.user.id);
  }

  @Post('invitations.resend')
  @DemoRestricted()
  @HttpCode(200)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Resend invitation email' })
  @ApiResponse({ status: 200, description: 'Invitation email resent' })
  async resend(
    @Req() req: any,
    @Body() dto: InvitationIdDto,
  ): Promise<{ success: boolean }> {
    // Service validates membership via invitation's workspace_id
    await this.invitationsService.resend(dto.id, req.user.id);
    return { success: true };
  }

  @Post('invitations.revoke')
  @DemoRestricted()
  @HttpCode(200)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Revoke pending invitation' })
  @ApiResponse({ status: 200, description: 'Invitation revoked' })
  async revoke(
    @Req() req: any,
    @Body() dto: InvitationIdDto,
  ): Promise<{ success: boolean }> {
    // Service validates membership via invitation's workspace_id
    await this.invitationsService.revoke(dto.id, req.user.id);
    return { success: true };
  }

  @Get('invitations.get')
  @Public()
  @ApiOperation({ summary: 'Get invitation details by token' })
  @ApiQuery({ name: 'token', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Invitation details' })
  async get(
    @Query('token') token: string,
  ): Promise<InvitationDetailsDto | null> {
    return this.invitationsService.getByToken(token);
  }

  @Post('invitations.accept')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'Accept invitation' })
  @ApiResponse({ status: 200, description: 'Invitation accepted' })
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Req() req: any,
  ): Promise<{ userId: string; workspaceId: string }> {
    // If user is logged in, pass their ID
    const currentUserId = req.user?.id;
    return this.invitationsService.accept(dto, currentUserId);
  }
}
