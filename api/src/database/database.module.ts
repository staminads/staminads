import { Global, Module } from '@nestjs/common';
import { ClickHouseService } from './clickhouse.service';

@Global()
@Module({
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class DatabaseModule {}
