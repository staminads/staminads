import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp } from '../common/decorators/client-ip.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipRateLimit } from '../common/decorators/throttle.decorator';
import { SessionPayloadDto } from './dto/session-payload.dto';
import { SessionPayloadHandler } from './session-payload.handler';

@SkipRateLimit() // High-volume endpoints - millions of devices may share same IP
@ApiTags('events')
@Controller('api')
export class EventsController {
  constructor(private readonly sessionPayloadHandler: SessionPayloadHandler) {}

  @Post('track')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'Track session with cumulative actions array',
    description:
      'Processes a session payload containing pageview and goal actions. ' +
      'Actions are deduplicated server-side using dedup_token.',
  })
  @ApiBody({ type: SessionPayloadDto })
  @ApiResponse({
    status: 200,
    description: 'Session payload processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
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
