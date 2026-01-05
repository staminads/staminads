import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CustomThrottlerGuard } from './throttler/throttler.guard';

@Module({
  providers: [
    // Throttler guard runs FIRST (before auth) to prevent resource exhaustion
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class CommonModule {}
