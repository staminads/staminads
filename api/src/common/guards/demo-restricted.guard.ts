import { BadRequestException, CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DemoRestrictedGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const isDemo =
      this.configService.get<string>('IS_DEMO', 'false') === 'true';

    if (isDemo) {
      throw new BadRequestException('This feature is disabled in demo');
    }

    return true;
  }
}
