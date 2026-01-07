import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
}

@ApiTags('workspaces')
@ApiSecurity('jwt-auth')
@Controller('api')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('workspaces.list')
  @ApiOperation({ summary: 'List workspaces for current user' })
  list(@Req() req: Request & { user: CurrentUser }) {
    return this.workspacesService.list(req.user);
  }

  @Get('workspaces.get')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiQuery({ name: 'id', type: String, required: true })
  get(@Query('id') id: string) {
    return this.workspacesService.get(id);
  }

  @Post('workspaces.create')
  @DemoRestricted()
  @ApiOperation({ summary: 'Create a new workspace' })
  create(@Req() req: any, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(dto, req.user);
  }

  @Post('workspaces.update')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('workspace.settings')
  @ApiOperation({ summary: 'Update an existing workspace' })
  update(@Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.update(dto);
  }

  @Post('workspaces.delete')
  @DemoRestricted()
  @HttpCode(200)
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('workspace.delete')
  @ApiOperation({ summary: 'Delete a workspace' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  })
  async delete(@Body('id') id: string) {
    await this.workspacesService.delete(id);
    return { success: true };
  }
}
