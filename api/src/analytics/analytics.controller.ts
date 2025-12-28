import { Controller, Post, Get, Body, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

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
