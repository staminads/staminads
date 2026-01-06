import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { UsersService } from '../../users/users.service';
import { ClickHouseService } from '../../database/clickhouse.service';
import { Session, User } from '../../common/entities';

export interface JwtPayload {
  sub: string;
  email: string;
  sessionId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly SESSION_CACHE_TTL = 60 * 1000; // 60 seconds

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly clickhouse: ClickHouseService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    const secret = configService.get<string>('ENCRYPTION_KEY');
    if (!secret) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    // Check if session is still valid (if sessionId is present)
    if (payload.sessionId) {
      const isValid = await this.validateSessionCached(
        payload.sessionId,
        payload.sub,
      );
      if (!isValid) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    // Get user from cache or database
    const user = await this.getUserCached(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    if (user.deleted_at) {
      throw new UnauthorizedException('Account has been deleted');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.is_super_admin,
    };
  }

  private async getUserCached(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}`;
    const cached = await this.cacheManager.get<User>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const user = await this.usersService.findById(userId);
    if (user) {
      await this.cacheManager.set(cacheKey, user, this.USER_CACHE_TTL);
    }
    return user;
  }

  private async validateSessionCached(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const cacheKey = `session:${sessionId}:${userId}`;
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const isValid = await this.validateSession(sessionId, userId);
    await this.cacheManager.set(cacheKey, isValid, this.SESSION_CACHE_TTL);
    return isValid;
  }

  private async validateSession(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.clickhouse.querySystem<Session>(
      `
      SELECT * FROM sessions FINAL
      WHERE id = {sessionId:String}
        AND user_id = {userId:String}
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
      { sessionId, userId },
    );

    return result.length > 0;
  }
}
