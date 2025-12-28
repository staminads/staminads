import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class DemoSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.query.secret as string;

    const demoSecret = this.configService.get<string>('DEMO_SECRET');

    if (!demoSecret) {
      throw new UnauthorizedException('Demo endpoint not configured');
    }

    if (!secret) {
      throw new UnauthorizedException('Missing secret parameter');
    }

    if (!this.timingSafeCompare(secret, demoSecret)) {
      throw new UnauthorizedException('Invalid secret');
    }

    return true;
  }

  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
