import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { MembersService } from './members.service';
import { ListMembersDto } from './dto/list-members.dto';
import { GetMemberDto } from './dto/get-member.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RemoveMemberDto } from './dto/remove-member.dto';
import { LeaveWorkspaceDto } from './dto/leave-workspace.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';

@ApiTags('members')
@ApiSecurity('jwt-auth')
@Controller('api')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get('members.list')
  @ApiOperation({ summary: 'List all members of a workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({
    status: 200,
    description: 'List of workspace members with user details',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workspace_id: { type: 'string' },
          user_id: { type: 'string' },
          role: {
            type: 'string',
            enum: ['owner', 'admin', 'editor', 'viewer'],
          },
          invited_by: { type: 'string', nullable: true },
          joined_at: { type: 'string' },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async list(@Query('workspace_id') workspaceId: string, @Request() req: any) {
    const dto: ListMembersDto = { workspace_id: workspaceId };
    return this.membersService.list(dto, req.user.id);
  }

  @Get('members.get')
  @ApiOperation({ summary: 'Get a specific member by user ID' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiQuery({ name: 'user_id', type: String, required: true })
  @ApiResponse({
    status: 200,
    description: 'Member details with user information',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workspace_id: { type: 'string' },
        user_id: { type: 'string' },
        role: { type: 'string', enum: ['owner', 'admin', 'editor', 'viewer'] },
        invited_by: { type: 'string', nullable: true },
        joined_at: { type: 'string' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async get(
    @Query('workspace_id') workspaceId: string,
    @Query('user_id') userId: string,
    @Request() req: any,
  ) {
    const dto: GetMemberDto = { workspace_id: workspaceId, user_id: userId };
    return this.membersService.get(dto, req.user.id);
  }

  @Post('members.updateRole')
  @DemoRestricted()
  @ApiOperation({ summary: "Update a member's role" })
  @ApiResponse({
    status: 200,
    description: 'Member role updated successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workspace_id: { type: 'string' },
        user_id: { type: 'string' },
        role: { type: 'string', enum: ['owner', 'admin', 'editor', 'viewer'] },
        invited_by: { type: 'string', nullable: true },
        joined_at: { type: 'string' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async updateRole(@Body() dto: UpdateRoleDto, @Request() req: any) {
    return this.membersService.updateRole(dto, req.user.id);
  }

  @Post('members.remove')
  @DemoRestricted()
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a member from a workspace' })
  @ApiResponse({
    status: 200,
    description: 'Member removed successfully',
    schema: {
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async remove(@Body() dto: RemoveMemberDto, @Request() req: any) {
    await this.membersService.remove(dto, req.user.id);
    return { success: true };
  }

  @Post('members.leave')
  @DemoRestricted()
  @HttpCode(200)
  @ApiOperation({ summary: 'Leave a workspace voluntarily' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
      required: ['workspace_id'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully left workspace',
    schema: {
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Cannot leave as last owner' })
  @ApiResponse({ status: 404, description: 'Not a member of this workspace' })
  async leave(@Body('workspace_id') workspaceId: string, @Request() req: any) {
    const dto: LeaveWorkspaceDto = { workspace_id: workspaceId };
    await this.membersService.leave(dto, req.user.id);
    return { success: true };
  }

  @Post('members.transferOwnership')
  @DemoRestricted()
  @ApiOperation({ summary: 'Transfer workspace ownership to another member' })
  @ApiResponse({
    status: 200,
    description: 'Ownership transferred successfully',
    schema: {
      type: 'object',
      properties: {
        old_owner: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            workspace_id: { type: 'string' },
            user_id: { type: 'string' },
            role: { type: 'string' },
            invited_by: { type: 'string', nullable: true },
            joined_at: { type: 'string' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
        new_owner: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            workspace_id: { type: 'string' },
            user_id: { type: 'string' },
            role: { type: 'string' },
            invited_by: { type: 'string', nullable: true },
            joined_at: { type: 'string' },
            created_at: { type: 'string' },
            updated_at: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Only owners can transfer ownership',
  })
  @ApiResponse({
    status: 404,
    description: 'New owner not a member of workspace',
  })
  async transferOwnership(
    @Body() dto: TransferOwnershipDto,
    @Request() req: any,
  ) {
    return this.membersService.transferOwnership(dto, req.user.id);
  }
}
