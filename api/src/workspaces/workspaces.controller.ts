import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspacesService } from './workspaces.service';

@Controller('api')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('workspaces.list')
  list() {
    return this.workspacesService.list();
  }

  @Get('workspaces.get')
  get(@Query('id') id: string) {
    return this.workspacesService.get(id);
  }

  @Post('workspaces.create')
  create(@Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(dto);
  }

  @Post('workspaces.update')
  update(@Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.update(dto);
  }

  @Post('workspaces.delete')
  @HttpCode(200)
  async delete(@Body('id') id: string) {
    await this.workspacesService.delete(id);
    return { success: true };
  }
}
