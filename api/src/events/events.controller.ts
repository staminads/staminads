import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { TrackEventDto, TrackBatchDto } from './dto/track-event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('api')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Public()
  @Post('track')
  @HttpCode(200)
  @ApiOperation({ summary: 'Track a single event' })
  async track(@Body() dto: TrackEventDto) {
    return this.eventsService.track(dto);
  }

  @Public()
  @Post('track.batch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Track multiple events in a batch' })
  async trackBatch(@Body() dto: TrackBatchDto) {
    return this.eventsService.trackBatch(dto.events);
  }
}
