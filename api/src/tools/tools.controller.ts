import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiResponse({ status: 200, description: 'Website metadata', type: WebsiteMetaResponse })
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
}
