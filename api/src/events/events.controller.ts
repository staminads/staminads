import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp } from '../common/decorators/client-ip.decorator';
import { ApiKeyRoute } from '../common/decorators/api-key-route.decorator';
import { SkipRateLimit } from '../common/decorators/throttle.decorator';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { SessionPayloadDto } from './dto/session-payload.dto';
import { SessionPayloadHandler } from './session-payload.handler';

@SkipRateLimit() // High-volume endpoints - millions of devices may share same IP
@ApiTags('events')
@Controller('api')
export class EventsController {
  constructor(private readonly sessionPayloadHandler: SessionPayloadHandler) {}

  @Post('track')
  @HttpCode(200)
  @ApiKeyRoute()
  @UseGuards(AuthGuard('api-key'), WorkspaceAuthGuard)
  @ApiOperation({
    summary: 'Track session with cumulative actions array',
    description:
      'Processes a session payload containing pageview and goal actions. ' +
      'Actions are processed incrementally using checkpoint-based delta sending. ' +
      'The server skips actions at indices <= checkpoint and processes only new actions.',
  })
  @ApiBody({ type: SessionPayloadDto })
  @ApiResponse({
    status: 200,
    description: 'Session payload processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        checkpoint: {
          type: 'number',
          description: 'Index of the last processed action',
          example: 5,
        },
      },
    },
  })
  async track(
    @Body() payload: SessionPayloadDto,
    @ClientIp() clientIp: string | null,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.sessionPayloadHandler.handle(
      payload,
      clientIp,
      origin,
      referer,
    );
  }
}
