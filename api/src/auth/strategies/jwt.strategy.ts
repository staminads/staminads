import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { ClickHouseService } from '../../database/clickhouse.service';
import { Session } from '../../common/entities';

export interface JwtPayload {
  sub: string;
  email: string;
  sessionId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly clickhouse: ClickHouseService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
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
      const isValid = await this.validateSession(
        payload.sessionId,
        payload.sub,
      );
      if (!isValid) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    // Get user from database
    const user = await this.usersService.findById(payload.sub);

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
