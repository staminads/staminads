import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { DemoRestrictedGuard } from '../guards/demo-restricted.guard';

export const IS_DEMO_RESTRICTED_KEY = 'isDemoRestricted';

export function DemoRestricted() {
  return applyDecorators(
    SetMetadata(IS_DEMO_RESTRICTED_KEY, true),
    UseGuards(DemoRestrictedGuard),
  );
}
