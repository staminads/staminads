import { Module, forwardRef } from '@nestjs/common';
import { FiltersController } from './filters.controller';
import { FiltersService } from './filters.service';
import { FilterBackfillService } from './backfill/backfill.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [WorkspacesModule, forwardRef(() => MembersModule)],
  controllers: [FiltersController],
  providers: [FiltersService, FilterBackfillService],
  exports: [FiltersService, FilterBackfillService],
})
export class FiltersModule {}
