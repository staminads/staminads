import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventBufferService } from './event-buffer.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [WorkspacesModule],
  controllers: [EventsController],
  providers: [EventsService, EventBufferService],
  exports: [EventsService, EventBufferService],
})
export class EventsModule {}
