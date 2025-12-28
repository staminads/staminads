import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
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

@ApiTags('workspaces')
@ApiSecurity('jwt-auth')
@Controller('api')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('workspaces.list')
  @ApiOperation({ summary: 'List all workspaces' })
  list() {
    return this.workspacesService.list();
  }

  @Get('workspaces.get')
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiQuery({ name: 'id', type: String, required: true })
  get(@Query('id') id: string) {
    return this.workspacesService.get(id);
  }

  @Post('workspaces.create')
  @ApiOperation({ summary: 'Create a new workspace' })
  create(@Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(dto);
  }

  @Post('workspaces.update')
  @ApiOperation({ summary: 'Update an existing workspace' })
  update(@Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.update(dto);
  }

  @Post('workspaces.delete')
  @HttpCode(200)
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
