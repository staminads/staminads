import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { DemoSecretGuard } from '../guards/demo-secret.guard';

export const IS_DEMO_PROTECTED_KEY = 'isDemoProtected';

export function DemoProtected() {
  return applyDecorators(
    SetMetadata(IS_DEMO_PROTECTED_KEY, true),
    UseGuards(DemoSecretGuard),
  );
}
