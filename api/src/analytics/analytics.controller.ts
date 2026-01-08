import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { ExtremesQueryDto, ExtremesResponse } from './dto/extremes-query.dto';
import type { AnalyticsTable } from './constants/tables';
import { ANALYTICS_TABLES } from './constants/tables';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { SkipRateLimit } from '../common/decorators/throttle.decorator';

@ApiTags('analytics')
@ApiSecurity('jwt-auth')
@SkipRateLimit() // Uses caching instead of rate limiting
@Controller('api')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('analytics.query')
  @HttpCode(200)
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({ summary: 'Execute an analytics query' })
  async query(@Body() dto: AnalyticsQueryDto) {
    return this.analyticsService.query(dto);
  }

  @Post('analytics.extremes')
  @HttpCode(200)
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({
    summary: 'Get min/max extremes of a metric across grouped data',
  })
  async extremes(@Body() dto: ExtremesQueryDto): Promise<ExtremesResponse> {
    return this.analyticsService.extremes(dto);
  }

  @Get('analytics.metrics')
  @ApiOperation({ summary: 'Get available metrics' })
  @ApiQuery({
    name: 'table',
    required: false,
    enum: ANALYTICS_TABLES,
    description: 'Filter metrics by table (sessions or pages)',
  })
  getMetrics(@Query('table') table?: AnalyticsTable) {
    return this.analyticsService.getAvailableMetrics(table);
  }

  @Get('analytics.dimensions')
  @ApiOperation({ summary: 'Get available dimensions' })
  @ApiQuery({
    name: 'table',
    required: false,
    enum: ANALYTICS_TABLES,
    description: 'Filter dimensions by table (sessions or pages)',
  })
  getDimensions(@Query('table') table?: AnalyticsTable) {
    return this.analyticsService.getAvailableDimensions(table);
  }

  @Get('analytics.tables')
  @ApiOperation({ summary: 'Get available analytics tables' })
  getTables() {
    return ANALYTICS_TABLES;
  }
}
