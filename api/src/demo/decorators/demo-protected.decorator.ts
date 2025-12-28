import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { DemoSecretGuard } from '../guards/demo-secret.guard';

export const IS_DEMO_PROTECTED_KEY = 'isDemoProtected';

export function DemoProtected() {
  return applyDecorators(
    SetMetadata(IS_DEMO_PROTECTED_KEY, true),
    UseGuards(DemoSecretGuard),
    ApiSecurity('demo-secret'),
    ApiQuery({
      name: 'secret',
      required: true,
      description: 'Demo secret from DEMO_SECRET environment variable',
    }),
  );
}
