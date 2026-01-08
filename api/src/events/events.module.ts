import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventBufferService } from './event-buffer.service';
import { SessionPayloadHandler } from './session-payload.handler';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MembersModule } from '../members/members.module';
import { GeoModule } from '../geo';

@Module({
  imports: [WorkspacesModule, MembersModule, GeoModule],
  controllers: [EventsController],
  providers: [EventsService, EventBufferService, SessionPayloadHandler],
  exports: [EventsService, EventBufferService],
})
export class EventsModule {}
