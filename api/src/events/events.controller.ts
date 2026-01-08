import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp } from '../common/decorators/client-ip.decorator';
import { RequireScope } from '../common/decorators/require-scope.decorator';
import { SkipRateLimit } from '../common/decorators/throttle.decorator';
import { ScopeGuard } from '../common/guards/scope.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { TrackEventDto, TrackBatchDto } from './dto/track-event.dto';
import { SessionPayloadDto } from './dto/session-payload.dto';
import { EventsService } from './events.service';
import { SessionPayloadHandler } from './session-payload.handler';

@SkipRateLimit() // High-volume endpoints - millions of devices may share same IP
@ApiTags('events')
@Controller('api')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly sessionPayloadHandler: SessionPayloadHandler,
  ) {}

  @Post('track')
  @HttpCode(200)
  @UseGuards(AuthGuard('api-key'), ScopeGuard, WorkspaceGuard)
  @RequireScope('events.track')
  @ApiOperation({ summary: 'Track a single event' })
  async track(@Body() dto: TrackEventDto, @ClientIp() clientIp: string | null) {
    return this.eventsService.track(dto, clientIp);
  }

  @Post('track.batch')
  @HttpCode(200)
  @UseGuards(AuthGuard('api-key'), ScopeGuard, WorkspaceGuard)
  @RequireScope('events.track')
  @ApiOperation({ summary: 'Track multiple events in a batch' })
  async trackBatch(
    @Body() dto: TrackBatchDto,
    @ClientIp() clientIp: string | null,
  ) {
    return this.eventsService.trackBatch(dto.events, clientIp);
  }

  @Post('track.session')
  @HttpCode(200)
  @UseGuards(AuthGuard('api-key'), ScopeGuard, WorkspaceGuard)
  @RequireScope('events.track')
  @ApiOperation({
    summary: 'Track session with cumulative actions array (V3)',
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
  async trackSession(
    @Body() payload: SessionPayloadDto,
    @ClientIp() clientIp: string | null,
  ) {
    return this.sessionPayloadHandler.handle(payload, clientIp);
  }
}
