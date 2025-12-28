import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { TrackEventDto, TrackBatchDto } from './dto/track-event.dto';
import { EventsService } from './events.service';

@Controller('api')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Public()
  @Post('track')
  @HttpCode(200)
  async track(@Body() dto: TrackEventDto) {
    return this.eventsService.track(dto);
  }

  @Public()
  @Post('track.batch')
  @HttpCode(200)
  async trackBatch(@Body() dto: TrackBatchDto) {
    return this.eventsService.trackBatch(dto.events);
  }
}
