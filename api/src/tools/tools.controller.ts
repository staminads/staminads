import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { WebsiteMetaDto, WebsiteMetaResponse } from './dto/website-meta.dto';
import { ToolsService } from './tools.service';

@Controller('api')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Public()
  @Post('tools.websiteMeta')
  @HttpCode(200)
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
