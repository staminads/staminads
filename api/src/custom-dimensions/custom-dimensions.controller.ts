import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CustomDimensionsService } from './custom-dimensions.service';
import { BackfillService } from './backfill/backfill.service';
import {
  CustomDimensionDefinition,
  CustomDimensionWithStaleness,
} from './entities/custom-dimension.entity';
import { CreateCustomDimensionDto } from './dto/create-custom-dimension.dto';
import { UpdateCustomDimensionDto } from './dto/update-custom-dimension.dto';
import { TestCustomDimensionDto, TestResult } from './dto/test-custom-dimension.dto';
import { ReorderCustomDimensionsDto } from './dto/reorder-custom-dimensions.dto';
import { StartBackfillDto } from './backfill/dto/start-backfill.dto';
import { BackfillTaskProgress } from './backfill/backfill-task.entity';

@ApiTags('customDimensions')
@ApiSecurity('jwt-auth')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class CustomDimensionsController {
  constructor(
    private readonly service: CustomDimensionsService,
    private readonly backfillService: BackfillService,
  ) {}

  @Get('customDimensions.list')
  @ApiOperation({ summary: 'List custom dimensions for workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of custom dimensions with staleness info' })
  async list(
    @Query('workspace_id') workspaceId: string,
  ): Promise<CustomDimensionWithStaleness[]> {
    return this.service.list(workspaceId);
  }

  @Get('customDimensions.get')
  @ApiOperation({ summary: 'Get custom dimension by ID' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Custom dimension with staleness info' })
  async get(
    @Query('workspace_id') workspaceId: string,
    @Query('id') id: string,
  ): Promise<CustomDimensionWithStaleness> {
    return this.service.get(workspaceId, id);
  }

  @Post('customDimensions.create')
  @ApiOperation({ summary: 'Create custom dimension' })
  @ApiResponse({ status: 201, description: 'Created custom dimension' })
  async create(
    @Body() dto: CreateCustomDimensionDto,
  ): Promise<CustomDimensionDefinition> {
    return this.service.create(dto);
  }

  @Post('customDimensions.update')
  @ApiOperation({ summary: 'Update custom dimension' })
  @ApiResponse({ status: 200, description: 'Updated custom dimension' })
  async update(
    @Body() dto: UpdateCustomDimensionDto,
  ): Promise<CustomDimensionDefinition> {
    return this.service.update(dto);
  }

  @Post('customDimensions.delete')
  @ApiOperation({ summary: 'Delete custom dimension' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Dimension deleted' })
  async delete(
    @Query('workspace_id') workspaceId: string,
    @Query('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.service.delete(workspaceId, id);
    return { success: true };
  }

  @Post('customDimensions.reorder')
  @ApiOperation({ summary: 'Reorder custom dimensions' })
  @ApiResponse({ status: 200, description: 'Dimensions reordered' })
  async reorder(
    @Body() dto: ReorderCustomDimensionsDto,
  ): Promise<{ success: boolean }> {
    await this.service.reorder(dto);
    return { success: true };
  }

  @Post('customDimensions.test')
  @ApiOperation({ summary: 'Test rules against sample values' })
  @ApiResponse({ status: 200, description: 'Test result' })
  async test(@Body() dto: TestCustomDimensionDto): Promise<TestResult> {
    return this.service.test(dto);
  }

  @Post('customDimensions.backfillStart')
  @ApiOperation({ summary: 'Start background backfill for all custom dimensions' })
  @ApiResponse({ status: 201, description: 'Task created' })
  async backfillStart(
    @Body() dto: StartBackfillDto,
  ): Promise<{ task_id: string }> {
    return this.backfillService.startBackfill(dto);
  }

  @Get('customDimensions.backfillStatus')
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

  @Post('customDimensions.backfillCancel')
  @ApiOperation({ summary: 'Cancel running backfill task' })
  @ApiQuery({ name: 'task_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Task cancelled' })
  async backfillCancel(
    @Query('task_id') taskId: string,
  ): Promise<{ success: boolean }> {
    return this.backfillService.cancelTask(taskId);
  }

  @Get('customDimensions.backfillList')
  @ApiOperation({ summary: 'List backfill tasks for workspace' })
  @ApiQuery({ name: 'workspace_id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of tasks' })
  async backfillList(
    @Query('workspace_id') workspaceId: string,
  ): Promise<BackfillTaskProgress[]> {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id is required');
    }
    return this.backfillService.listTasks(workspaceId);
  }
}
