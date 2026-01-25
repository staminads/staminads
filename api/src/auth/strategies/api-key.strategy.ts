import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { ApiKeyRole } from '../../common/entities/api-key.entity';
import { parseClickHouseDateTime } from '../../common/utils/datetime.util';

export interface ApiKeyPayload {
  type: 'api-key';
  id: string; // Set to `api-key:{keyId}` for compatibility with req.user.id
  keyId: string;
  workspaceId: string;
  role: ApiKeyRole;
}

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private readonly apiKeysService: ApiKeysService) {
    super();
  }

  async validate(token: string): Promise<ApiKeyPayload> {
    // Only accept stam_live_ prefixed tokens
    if (!token.startsWith('stam_live_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const apiKey = await this.apiKeysService.findByToken(token);

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (apiKey.status !== 'active') {
      throw new UnauthorizedException(`API key is ${apiKey.status}`);
    }

    if (apiKey.expires_at) {
      const expiresAt = parseClickHouseDateTime(apiKey.expires_at);
      if (expiresAt < new Date()) {
        throw new UnauthorizedException('API key has expired');
      }
    }

    if (!apiKey.workspace_id) {
      throw new UnauthorizedException('API key not bound to workspace');
    }

    // Update last_used_at (async, don't wait)
    this.apiKeysService.updateLastUsed(apiKey.id).catch(() => {});

    return {
      type: 'api-key',
      id: `api-key:${apiKey.id}`,
      keyId: apiKey.id,
      workspaceId: apiKey.workspace_id,
      role: apiKey.role,
    };
  }
}
