import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';

@Module({
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
