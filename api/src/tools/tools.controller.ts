import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebsiteMetaDto, WebsiteMetaResponse } from './dto/website-meta.dto';
import { ToolsService } from './tools.service';

@ApiTags('tools')
@Controller('api')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Public()
  @Post('tools.websiteMeta')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch website title and logo' })
  @ApiResponse({
    status: 200,
    description: 'Website metadata',
    type: WebsiteMetaResponse,
  })
  @ApiResponse({ status: 400, description: 'Failed to fetch metadata' })
  async websiteMeta(@Body() dto: WebsiteMetaDto): Promise<WebsiteMetaResponse> {
    try {
      return await this.toolsService.getWebsiteMeta(dto.url);
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch website metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @Public()
  @Get('tools.favicon')
  @ApiOperation({ summary: 'Fetch and proxy website favicon' })
  @ApiQuery({
    name: 'url',
    type: String,
    required: true,
    description: 'Website URL to fetch favicon for',
  })
  @ApiResponse({ status: 200, description: 'Favicon image binary' })
  async favicon(
    @Query('url') url: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.toolsService.getFavicon(url);

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800, immutable', // 7 days
    });

    res.send(buffer);
  }
}
