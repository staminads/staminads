import { Module } from '@nestjs/common';
import { CustomDimensionsController } from './custom-dimensions.controller';
import { CustomDimensionsService } from './custom-dimensions.service';
import { BackfillService } from './backfill/backfill.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [WorkspacesModule],
  controllers: [CustomDimensionsController],
  providers: [CustomDimensionsService, BackfillService],
  exports: [CustomDimensionsService, BackfillService],
})
export class CustomDimensionsModule {}
