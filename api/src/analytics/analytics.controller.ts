import { Controller, Post, Get, Body, HttpCode } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@Controller('api')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('analytics.query')
  @HttpCode(200)
  async query(@Body() dto: AnalyticsQueryDto) {
    return this.analyticsService.query(dto);
  }

  @Get('analytics.metrics')
  getMetrics() {
    return this.analyticsService.getAvailableMetrics();
  }

  @Get('analytics.dimensions')
  getDimensions() {
    return this.analyticsService.getAvailableDimensions();
  }
}
