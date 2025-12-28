import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventBufferService } from './event-buffer.service';

@Module({
  controllers: [EventsController],
  providers: [EventsService, EventBufferService],
  exports: [EventsService, EventBufferService],
})
export class EventsModule {}
