import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp } from '../common/decorators/client-ip.decorator';
import { RequireScope } from '../common/decorators/require-scope.decorator';
import { ScopeGuard } from '../common/guards/scope.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { TrackEventDto, TrackBatchDto } from './dto/track-event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('api')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

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
}
