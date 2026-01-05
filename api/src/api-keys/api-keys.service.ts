import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { MembersService } from '../members/members.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ListApiKeysDto } from './dto/list-api-keys.dto';
import { RevokeApiKeyDto } from './dto/revoke-api-key.dto';
import { CreateApiKeyResponseDto } from './dto/create-api-key-response.dto';
import {
  ApiKey,
  PublicApiKey,
  ApiScope,
  SCOPE_TO_PERMISSION,
} from '../common/entities/api-key.entity';
import { generateId, generateApiKeyToken, hashToken } from '../common/crypto';
import { hasPermission } from '../common/permissions';
import {
  toClickHouseDateTime,
  isoToClickHouseDateTime,
} from '../common/utils/datetime.util';

interface ApiKeyRow extends Omit<ApiKey, 'scopes'> {
  scopes: string; // JSON string from ClickHouse
}

function parseApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    key_hash: row.key_hash,
    key_prefix: row.key_prefix,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description,
    scopes: JSON.parse(row.scopes),
    status: row.status,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    failed_attempts_count: row.failed_attempts_count,
    last_failed_attempt_at: row.last_failed_attempt_at,
    created_by: row.created_by,
    revoked_by: row.revoked_by,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeApiKey(
  apiKey: ApiKey,
): Omit<ApiKey, 'scopes'> & { scopes: string } {
  return {
    id: apiKey.id,
    key_hash: apiKey.key_hash,
    key_prefix: apiKey.key_prefix,
    user_id: apiKey.user_id,
    workspace_id: apiKey.workspace_id,
    name: apiKey.name,
    description: apiKey.description,
    scopes: JSON.stringify(apiKey.scopes),
    status: apiKey.status,
    expires_at: isoToClickHouseDateTime(apiKey.expires_at),
    last_used_at: apiKey.last_used_at,
    failed_attempts_count: apiKey.failed_attempts_count,
    last_failed_attempt_at: apiKey.last_failed_attempt_at,
    created_by: apiKey.created_by,
    revoked_by: apiKey.revoked_by,
    revoked_at: apiKey.revoked_at,
    created_at: apiKey.created_at,
    updated_at: apiKey.updated_at,
  };
}

function toPublicApiKey(apiKey: ApiKey): PublicApiKey {
  const { key_hash, ...publicKey } = apiKey;
  return publicKey;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    @Inject(forwardRef(() => MembersService))
    private readonly membersService: MembersService,
  ) {}

  async create(
    dto: CreateApiKeyDto & { user_id: string },
    created_by: string,
  ): Promise<CreateApiKeyResponseDto> {
    // Validate scopes before creating
    await this.validateScopesForUser(dto.workspace_id, created_by, dto.scopes);

    const now = toClickHouseDateTime();
    const { key, hash, prefix } = generateApiKeyToken();

    const apiKey: ApiKey = {
      id: generateId(),
      key_hash: hash,
      key_prefix: prefix,
      user_id: dto.user_id,
      workspace_id: dto.workspace_id ?? null,
      name: dto.name,
      description: dto.description ?? '',
      scopes: dto.scopes,
      status: 'active',
      expires_at: dto.expires_at ?? null,
      last_used_at: null,
      failed_attempts_count: 0,
      last_failed_attempt_at: null,
      created_by,
      revoked_by: null,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('api_keys', [serializeApiKey(apiKey)]);

    return {
      key,
      apiKey: toPublicApiKey(apiKey),
    };
  }

  async list(dto: ListApiKeysDto = {}): Promise<PublicApiKey[]> {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (dto.user_id) {
      whereClauses.push('user_id = {user_id:String}');
      params.user_id = dto.user_id;
    }

    if (dto.workspace_id !== undefined) {
      if (dto.workspace_id === null) {
        whereClauses.push('workspace_id IS NULL');
      } else {
        whereClauses.push('workspace_id = {workspace_id:String}');
        params.workspace_id = dto.workspace_id;
      }
    }

    if (dto.status) {
      whereClauses.push('status = {status:String}');
      params.status = dto.status;
    }

    // Build WHERE clause - always include the deduplication condition
    const dedupCondition = `(id, updated_at) IN (
      SELECT id, max(updated_at) FROM api_keys GROUP BY id
    )`;

    let whereClause: string;
    if (whereClauses.length > 0) {
      whereClause = `WHERE ${whereClauses.join(' AND ')} AND ${dedupCondition}`;
    } else {
      whereClause = `WHERE ${dedupCondition}`;
    }

    const rows = await this.clickhouse.querySystem<ApiKeyRow>(
      `SELECT * FROM api_keys
       ${whereClause}
       ORDER BY created_at DESC`,
      params,
    );

    return rows.map((row) => toPublicApiKey(parseApiKey(row)));
  }

  async get(id: string): Promise<PublicApiKey> {
    const rows = await this.clickhouse.querySystem<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = {id:String} ORDER BY updated_at DESC LIMIT 1',
      { id },
    );

    if (rows.length === 0) {
      throw new NotFoundException(`API key ${id} not found`);
    }

    return toPublicApiKey(parseApiKey(rows[0]));
  }

  async revoke(dto: RevokeApiKeyDto): Promise<PublicApiKey> {
    const apiKey = await this.get(dto.id);

    // Get the full API key from database to perform update
    const rows = await this.clickhouse.querySystem<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = {id:String} ORDER BY updated_at DESC LIMIT 1',
      { id: dto.id },
    );

    if (rows.length === 0) {
      throw new NotFoundException(`API key ${dto.id} not found`);
    }

    const fullApiKey = parseApiKey(rows[0]);
    const now = toClickHouseDateTime();

    const updated: ApiKey = {
      ...fullApiKey,
      status: 'revoked',
      revoked_by: dto.revoked_by,
      revoked_at: now,
      updated_at: now,
    };

    // Delete and re-insert (ClickHouse pattern)
    await this.clickhouse.commandSystem(
      `ALTER TABLE api_keys DELETE WHERE id = '${dto.id}'`,
    );
    await this.clickhouse.insertSystem('api_keys', [serializeApiKey(updated)]);

    return toPublicApiKey(updated);
  }

  /**
   * Check if API key is expired based on expires_at timestamp
   */
  private isExpired(apiKey: ApiKey): boolean {
    if (!apiKey.expires_at) {
      return false;
    }
    // Parse ClickHouse DateTime64 as UTC
    const expiresAt = new Date(apiKey.expires_at.replace(' ', 'T') + 'Z');
    return expiresAt < new Date();
  }

  /**
   * Update API key status to expired if expires_at has passed
   * This can be called periodically or when fetching keys
   */
  async updateExpiredStatus(id: string): Promise<void> {
    const rows = await this.clickhouse.querySystem<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = {id:String} ORDER BY updated_at DESC LIMIT 1',
      { id },
    );

    if (rows.length === 0) {
      return;
    }

    const apiKey = parseApiKey(rows[0]);

    if (apiKey.status === 'active' && this.isExpired(apiKey)) {
      const now = toClickHouseDateTime();
      const updated: ApiKey = {
        ...apiKey,
        status: 'expired',
        updated_at: now,
      };

      await this.clickhouse.commandSystem(
        `ALTER TABLE api_keys DELETE WHERE id = '${id}'`,
      );
      await this.clickhouse.insertSystem('api_keys', [
        serializeApiKey(updated),
      ]);
    }
  }

  /**
   * Find API key by raw token (for authentication).
   * Hashes the token and looks up by key_hash.
   */
  async findByToken(token: string): Promise<ApiKey | null> {
    const hash = hashToken(token);

    const rows = await this.clickhouse.querySystem<ApiKeyRow>(
      `SELECT * FROM api_keys
       WHERE key_hash = {hash:String}
       ORDER BY updated_at DESC
       LIMIT 1`,
      { hash },
    );

    if (rows.length === 0) {
      return null;
    }

    return parseApiKey(rows[0]);
  }

  /**
   * Update last_used_at timestamp (fire-and-forget).
   */
  async updateLastUsed(id: string): Promise<void> {
    const now = toClickHouseDateTime();

    const rows = await this.clickhouse.querySystem<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = {id:String} ORDER BY updated_at DESC LIMIT 1',
      { id },
    );

    if (rows.length === 0) {
      return;
    }

    const apiKey = parseApiKey(rows[0]);
    const updated: ApiKey = {
      ...apiKey,
      last_used_at: now,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('api_keys', [serializeApiKey(updated)]);
  }

  /**
   * Validate that the user can grant the requested scopes.
   * Users can only grant scopes they have permission for.
   */
  async validateScopesForUser(
    workspaceId: string,
    userId: string,
    scopes: ApiScope[],
  ): Promise<void> {
    const membership = await this.membersService.getMembership(
      workspaceId,
      userId,
    );

    if (!membership) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    // Check integrations.manage permission (required to create API keys)
    if (!hasPermission(membership.role, 'integrations.manage')) {
      throw new ForbiddenException(
        'Insufficient permissions to create API keys',
      );
    }

    // Validate each requested scope
    for (const scope of scopes) {
      const requiredPermission = SCOPE_TO_PERMISSION[scope];

      // null means any API key creator can grant this scope
      if (requiredPermission === null) continue;

      if (!hasPermission(membership.role, requiredPermission)) {
        throw new ForbiddenException(
          `Cannot grant scope '${scope}': missing '${requiredPermission}' permission`,
        );
      }
    }
  }
}
