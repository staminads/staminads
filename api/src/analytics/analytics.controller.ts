import { Controller, Post, Get, Body, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { ExtremesQueryDto, ExtremesResponse } from './dto/extremes-query.dto';

@ApiTags('analytics')
@ApiSecurity('jwt-auth')
@Controller('api')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('analytics.query')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute an analytics query' })
  async query(@Body() dto: AnalyticsQueryDto) {
    return this.analyticsService.query(dto);
  }

  @Post('analytics.extremes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get min/max extremes of a metric across grouped data' })
  async extremes(@Body() dto: ExtremesQueryDto): Promise<ExtremesResponse> {
    return this.analyticsService.extremes(dto);
  }

  @Get('analytics.metrics')
  @ApiOperation({ summary: 'Get available metrics' })
  getMetrics() {
    return this.analyticsService.getAvailableMetrics();
  }

  @Get('analytics.dimensions')
  @ApiOperation({ summary: 'Get available dimensions' })
  getDimensions() {
    return this.analyticsService.getAvailableDimensions();
  }
}
