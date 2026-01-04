import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { ApiScope } from '../../common/entities/api-key.entity';

export interface ApiKeyPayload {
  type: 'api-key';
  keyId: string;
  workspaceId: string;
  scopes: ApiScope[];
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

    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    if (!apiKey.workspace_id) {
      throw new UnauthorizedException('API key not bound to workspace');
    }

    // Update last_used_at (async, don't wait)
    this.apiKeysService.updateLastUsed(apiKey.id).catch(() => {});

    return {
      type: 'api-key',
      keyId: apiKey.id,
      workspaceId: apiKey.workspace_id,
      scopes: apiKey.scopes,
    };
  }
}
