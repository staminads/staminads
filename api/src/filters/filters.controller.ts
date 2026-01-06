import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { FiltersService } from './filters.service';
import { FilterBackfillService } from './backfill/backfill.service';
import { FilterDefinition } from './entities/filter.entity';
import { CreateFilterDto } from './dto/create-filter.dto';
import { UpdateFilterDto } from './dto/update-filter.dto';
import { ReorderFiltersDto } from './dto/reorder-filters.dto';
import { StartBackfillDto } from './backfill/dto/start-backfill.dto';
import {
  BackfillSuccessResponseDto,
  BackfillStartResponseDto,
} from './backfill/dto/backfill-response.dto';
import { BackfillTaskProgress } from './backfill/backfill-task.entity';
import { BackfillSummary } from './backfill/backfill.service';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';

@ApiTags('filters')
@ApiSecurity('jwt-auth')
@Controller('api')
export class FiltersController {
  constructor(
    private readonly service: FiltersService,
    private readonly backfillService: FilterBackfillService,
  ) {}

  @Get('filters.list')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'List filters for workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiQuery({
    name: 'tags',
    type: [String],
    required: false,
    description: 'Filter by tags',
  })
  @ApiResponse({ status: 200, description: 'List of filters' })
  async list(
    @Query('workspace_id') workspaceId: string,
    @Query('tags') tags?: string | string[],
  ): Promise<FilterDefinition[]> {
    const tagArray = tags ? (Array.isArray(tags) ? tags : [tags]) : undefined;
    return this.service.list(workspaceId, tagArray);
  }

  @Get('filters.get')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Get filter by ID' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Filter definition' })
  async get(
    @Query('workspace_id') workspaceId: string,
    @Query('id') id: string,
  ): Promise<FilterDefinition> {
    return this.service.get(workspaceId, id);
  }

  @Post('filters.create')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Create filter' })
  @ApiResponse({ status: 201, description: 'Created filter' })
  async create(@Body() dto: CreateFilterDto): Promise<FilterDefinition> {
    return this.service.create(dto);
  }

  @Post('filters.update')
  @DemoRestricted()
  @HttpCode(200)
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Update filter' })
  @ApiResponse({ status: 200, description: 'Updated filter' })
  async update(@Body() dto: UpdateFilterDto): Promise<FilterDefinition> {
    return this.service.update(dto);
  }

  @Post('filters.delete')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Delete filter' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, type: BackfillSuccessResponseDto })
  async delete(
    @Query('workspace_id') workspaceId: string,
    @Query('id') id: string,
  ): Promise<BackfillSuccessResponseDto> {
    await this.service.delete(workspaceId, id);
    return { success: true };
  }

  @Post('filters.reorder')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Reorder filters' })
  @ApiResponse({ status: 200, type: BackfillSuccessResponseDto })
  async reorder(@Body() dto: ReorderFiltersDto): Promise<BackfillSuccessResponseDto> {
    await this.service.reorder(dto);
    return { success: true };
  }

  @Get('filters.listTags')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'List unique tags across all filters' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of unique tags' })
  async listTags(
    @Query('workspace_id') workspaceId: string,
  ): Promise<string[]> {
    return this.service.listTags(workspaceId);
  }

  @Post('filters.backfillStart')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Start background backfill for all filters' })
  @ApiResponse({ status: 201, type: BackfillStartResponseDto })
  async backfillStart(
    @Body() dto: StartBackfillDto,
  ): Promise<BackfillStartResponseDto> {
    return this.backfillService.startBackfill(dto);
  }

  @Get('filters.backfillStatus')
  @ApiOperation({ summary: 'Get backfill task status' })
  @ApiQuery({ name: 'task_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Task progress' })
  async backfillStatus(
    @Query('task_id') taskId: string,
  ): Promise<BackfillTaskProgress> {
    if (!taskId) {
      throw new BadRequestException('task_id is required');
    }
    return this.backfillService.getTaskStatus(taskId);
  }

  @Post('filters.backfillCancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel running backfill task' })
  @ApiQuery({ name: 'task_id', type: String, required: true })
  @ApiResponse({ status: 200, type: BackfillSuccessResponseDto })
  async backfillCancel(
    @Query('task_id') taskId: string,
  ): Promise<BackfillSuccessResponseDto> {
    return this.backfillService.cancelTask(taskId);
  }

  @Get('filters.backfillList')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'List backfill tasks for workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of tasks' })
  async backfillList(
    @Query('workspace_id') workspaceId: string,
  ): Promise<BackfillTaskProgress[]> {
    return this.backfillService.listTasks(workspaceId);
  }

  @Get('filters.backfillSummary')
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Get backfill status summary for workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Backfill summary' })
  async backfillSummary(
    @Query('workspace_id') workspaceId: string,
  ): Promise<BackfillSummary> {
    return this.backfillService.getBackfillSummary(workspaceId);
  }
}
