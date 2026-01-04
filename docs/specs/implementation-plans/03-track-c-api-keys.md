# Track C: API Keys Module Implementation Plan

**Track:** C - API Keys Module
**Dependencies:** Phase 0 (Foundation)
**Blocks:** None (independent feature)

---

## Overview

The API Keys module enables programmatic access to the Staminads API. Each key is associated with a service account user and has scoped permissions. Keys are shown only once at creation and stored as SHA-256 hashes.

---

## Files to Create

```
api/src/api-keys/
├── api-keys.module.ts
├── api-keys.service.ts
├── api-keys.controller.ts
├── api-keys.service.spec.ts
├── guards/
│   └── api-key.guard.ts
├── decorators/
│   └── require-scope.decorator.ts
└── dto/
    ├── create-api-key.dto.ts
    └── update-api-key.dto.ts
```

---

## Task 1: DTOs

### 1.1 Create API Key DTO

**File:** `api/src/api-keys/dto/create-api-key.dto.ts`

```typescript
import {
  IsString,
  IsArray,
  IsOptional,
  IsDateString,
  MinLength,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { ApiScope } from '../../common/entities';

export class CreateApiKeyDto {
  @IsString()
  workspaceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes: ApiScope[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CreateApiKeyResponseDto {
  id: string;
  key: string; // Only returned once!
  key_prefix: string;
  name: string;
  scopes: ApiScope[];
  created_at: string;
}
```

### 1.2 Update API Key DTO

**File:** `api/src/api-keys/dto/update-api-key.dto.ts`

```typescript
import {
  IsString,
  IsArray,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiScope } from '../../common/entities';

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: ApiScope[];
}
```

---

## Task 2: API Keys Service

**File:** `api/src/api-keys/api-keys.service.ts`

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import {
  generateId,
  generateApiKey,
  hashToken,
  verifyTokenHash,
} from '../common/crypto';
import { ApiKey, PublicApiKey, API_SCOPES, ApiScope } from '../common/entities';
import { CreateApiKeyDto, CreateApiKeyResponseDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  /**
   * List all API keys for a workspace
   */
  async list(workspaceId: string): Promise<PublicApiKey[]> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE workspace_id = {workspaceId:String}
        AND status = 'active'
      ORDER BY created_at DESC
    `, { workspaceId });

    return result.map(this.toPublicApiKey);
  }

  /**
   * Get API key by ID
   */
  async get(id: string): Promise<PublicApiKey | null> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE id = {id:String}
      LIMIT 1
    `, { id });

    return result[0] ? this.toPublicApiKey(result[0]) : null;
  }

  /**
   * Create a new API key
   * Returns the full key only once - it cannot be retrieved later
   */
  async create(
    dto: CreateApiKeyDto,
    createdBy: string,
  ): Promise<CreateApiKeyResponseDto> {
    // Validate scopes
    const invalidScopes = dto.scopes.filter(
      (scope) => !Object.keys(API_SCOPES).includes(scope),
    );
    if (invalidScopes.length > 0) {
      throw new BadRequestException(`Invalid scopes: ${invalidScopes.join(', ')}`);
    }

    const id = generateId();
    const { key, hash, prefix } = generateApiKey();
    const now = new Date().toISOString();

    // Create a service account user for this API key
    const serviceAccountId = generateId();
    await this.clickhouse.insertSystem('users', [{
      id: serviceAccountId,
      email: `api-key-${id}@service.staminads.local`,
      password_hash: null,
      name: `API Key: ${dto.name}`,
      type: 'service_account',
      status: 'active',
      is_super_admin: 0,
      last_login_at: null,
      failed_login_attempts: 0,
      locked_until: null,
      password_changed_at: null,
      deleted_at: null,
      deleted_by: null,
      created_at: now,
      updated_at: now,
    }]);

    // Create the API key
    await this.clickhouse.insertSystem('api_keys', [{
      id,
      key_hash: hash,
      key_prefix: prefix,
      user_id: serviceAccountId,
      workspace_id: dto.workspaceId,
      name: dto.name,
      description: dto.description || '',
      scopes: JSON.stringify(dto.scopes),
      status: 'active',
      expires_at: dto.expiresAt || null,
      last_used_at: null,
      failed_attempts_count: 0,
      last_failed_attempt_at: null,
      created_by: createdBy,
      revoked_by: null,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    }]);

    return {
      id,
      key, // Only time this is returned!
      key_prefix: prefix,
      name: dto.name,
      scopes: dto.scopes,
      created_at: now,
    };
  }

  /**
   * Update API key metadata
   */
  async update(id: string, dto: UpdateApiKeyDto): Promise<PublicApiKey> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE id = {id:String}
        AND status = 'active'
      LIMIT 1
    `, { id });

    const apiKey = result[0];
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    // Validate scopes if updating
    if (dto.scopes) {
      const invalidScopes = dto.scopes.filter(
        (scope) => !Object.keys(API_SCOPES).includes(scope),
      );
      if (invalidScopes.length > 0) {
        throw new BadRequestException(`Invalid scopes: ${invalidScopes.join(', ')}`);
      }
    }

    const now = new Date().toISOString();
    const updated = {
      ...apiKey,
      name: dto.name || apiKey.name,
      description: dto.description !== undefined ? dto.description : apiKey.description,
      scopes: dto.scopes ? JSON.stringify(dto.scopes) : apiKey.scopes,
      updated_at: now,
    };

    await this.clickhouse.insertSystem('api_keys', [updated]);

    return this.toPublicApiKey({
      ...updated,
      scopes: dto.scopes || JSON.parse(apiKey.scopes as unknown as string),
    });
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string, revokedBy: string): Promise<void> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE id = {id:String}
        AND status = 'active'
      LIMIT 1
    `, { id });

    const apiKey = result[0];
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    const now = new Date().toISOString();

    await this.clickhouse.insertSystem('api_keys', [{
      ...apiKey,
      status: 'revoked',
      revoked_by: revokedBy,
      revoked_at: now,
      updated_at: now,
    }]);
  }

  /**
   * Rotate an API key (revoke old, create new with same settings)
   */
  async rotate(
    id: string,
    revokedBy: string,
  ): Promise<CreateApiKeyResponseDto> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE id = {id:String}
        AND status = 'active'
      LIMIT 1
    `, { id });

    const oldKey = result[0];
    if (!oldKey) {
      throw new NotFoundException('API key not found');
    }

    // Revoke old key
    await this.revoke(id, revokedBy);

    // Create new key with same settings
    const scopes = typeof oldKey.scopes === 'string'
      ? JSON.parse(oldKey.scopes)
      : oldKey.scopes;

    return this.create(
      {
        workspaceId: oldKey.workspace_id!,
        name: oldKey.name,
        description: oldKey.description,
        scopes,
        expiresAt: oldKey.expires_at || undefined,
      },
      revokedBy,
    );
  }

  /**
   * Authenticate a request using an API key
   */
  async authenticate(authHeader: string): Promise<{
    user: { id: string; type: 'service_account' };
    apiKey: ApiKey;
    scopes: ApiScope[];
  } | null> {
    const key = authHeader.replace('Bearer ', '');
    if (!key.startsWith('sk_live_')) {
      return null;
    }

    // Get prefix for lookup
    const prefix = key.substring(0, 15);
    const keyHash = hashToken(key);

    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE key_prefix = {prefix:String}
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1
    `, { prefix });

    const apiKey = result[0];
    if (!apiKey) {
      return null;
    }

    // Constant-time comparison
    if (!verifyTokenHash(key, apiKey.key_hash)) {
      await this.incrementFailedAttempts(apiKey.id);
      return null;
    }

    // Update last used
    await this.updateLastUsed(apiKey.id);

    const scopes = typeof apiKey.scopes === 'string'
      ? JSON.parse(apiKey.scopes)
      : apiKey.scopes;

    return {
      user: { id: apiKey.user_id, type: 'service_account' },
      apiKey,
      scopes,
    };
  }

  /**
   * Check if API key has required scope
   */
  hasScope(scopes: ApiScope[], requiredScope: ApiScope): boolean {
    return scopes.includes(requiredScope);
  }

  private async incrementFailedAttempts(id: string): Promise<void> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE id = {id:String}
      LIMIT 1
    `, { id });

    const apiKey = result[0];
    if (!apiKey) return;

    await this.clickhouse.insertSystem('api_keys', [{
      ...apiKey,
      failed_attempts_count: apiKey.failed_attempts_count + 1,
      last_failed_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);
  }

  private async updateLastUsed(id: string): Promise<void> {
    const result = await this.clickhouse.querySystem<ApiKey>(`
      SELECT * FROM api_keys FINAL
      WHERE id = {id:String}
      LIMIT 1
    `, { id });

    const apiKey = result[0];
    if (!apiKey) return;

    await this.clickhouse.insertSystem('api_keys', [{
      ...apiKey,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);
  }

  private toPublicApiKey(apiKey: ApiKey): PublicApiKey {
    const { key_hash, ...publicKey } = apiKey;
    return {
      ...publicKey,
      scopes: typeof apiKey.scopes === 'string'
        ? JSON.parse(apiKey.scopes)
        : apiKey.scopes,
    };
  }
}
```

---

## Task 3: API Key Guard

**File:** `api/src/api-keys/guards/api-key.guard.ts`

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from '../api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    // Check if it's an API key (starts with sk_live_)
    if (authHeader.includes('sk_live_')) {
      const result = await this.apiKeysService.authenticate(authHeader);
      if (!result) {
        throw new UnauthorizedException('Invalid API key');
      }

      request.user = result.user;
      request.apiKey = result.apiKey;
      request.scopes = result.scopes;
      return true;
    }

    // Not an API key, let other guards handle it
    return true;
  }
}
```

---

## Task 4: Require Scope Decorator

**File:** `api/src/api-keys/decorators/require-scope.decorator.ts`

```typescript
import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ApiScope } from '../../common/entities';

export const SCOPE_KEY = 'requiredScope';

/**
 * Decorator to require a specific API scope
 * Use with ApiKeyGuard
 */
export const RequireScope = (scope: ApiScope) => SetMetadata(SCOPE_KEY, scope);

/**
 * Guard to check scope after ApiKeyGuard
 */
import { Injectable, CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScope = this.reflector.get<ApiScope>(
      SCOPE_KEY,
      context.getHandler(),
    );

    if (!requiredScope) {
      return true; // No scope required
    }

    const request = context.switchToHttp().getRequest();

    // Skip scope check for JWT auth (not API key)
    if (!request.apiKey) {
      return true;
    }

    const scopes: ApiScope[] = request.scopes || [];
    if (!scopes.includes(requiredScope)) {
      throw new ForbiddenException(`Missing required scope: ${requiredScope}`);
    }

    return true;
  }
}
```

---

## Task 5: API Keys Controller

**File:** `api/src/api-keys/api-keys.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto, CreateApiKeyResponseDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { PublicApiKey } from '../common/entities';

@ApiTags('api-keys')
@ApiSecurity('jwt-auth')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get('apiKeys.list')
  @ApiOperation({ summary: 'List API keys for workspace' })
  @ApiQuery({ name: 'workspaceId', type: String, required: true })
  @ApiResponse({ status: 200, description: 'List of API keys' })
  async list(@Query('workspaceId') workspaceId: string): Promise<PublicApiKey[]> {
    return this.apiKeysService.list(workspaceId);
  }

  @Get('apiKeys.get')
  @ApiOperation({ summary: 'Get API key details' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'API key details (not the key itself)' })
  async get(@Query('id') id: string): Promise<PublicApiKey | null> {
    return this.apiKeysService.get(id);
  }

  @Post('apiKeys.create')
  @ApiOperation({ summary: 'Create new API key (key shown only once!)' })
  @ApiResponse({ status: 201, description: 'Created API key with full key' })
  async create(
    @Request() req,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreateApiKeyResponseDto> {
    return this.apiKeysService.create(dto, req.user.id);
  }

  @Post('apiKeys.update')
  @ApiOperation({ summary: 'Update API key metadata' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'Updated API key' })
  async update(
    @Query('id') id: string,
    @Body() dto: UpdateApiKeyDto,
  ): Promise<PublicApiKey> {
    return this.apiKeysService.update(id, dto);
  }

  @Post('apiKeys.revoke')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'API key revoked' })
  async revoke(
    @Request() req,
    @Query('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.apiKeysService.revoke(id, req.user.id);
    return { success: true };
  }

  @Post('apiKeys.rotate')
  @ApiOperation({ summary: 'Rotate API key (revoke old, create new)' })
  @ApiQuery({ name: 'id', type: String, required: true })
  @ApiResponse({ status: 200, description: 'New API key (key shown only once!)' })
  async rotate(
    @Request() req,
    @Query('id') id: string,
  ): Promise<CreateApiKeyResponseDto> {
    return this.apiKeysService.rotate(id, req.user.id);
  }
}
```

---

## Task 6: API Keys Module

**File:** `api/src/api-keys/api-keys.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ScopeGuard } from './decorators/require-scope.decorator';

@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard, ScopeGuard],
  exports: [ApiKeysService, ApiKeyGuard, ScopeGuard],
})
export class ApiKeysModule {}
```

---

## Task 7: Unit Tests

**File:** `api/src/api-keys/api-keys.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysService } from './api-keys.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  beforeEach(async () => {
    const mockClickhouse = {
      querySystem: jest.fn(),
      insertSystem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: ClickHouseService, useValue: mockClickhouse },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    clickhouse = module.get(ClickHouseService);
  });

  describe('create', () => {
    it('should create an API key and return the key once', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const result = await service.create(
        {
          workspaceId: 'ws-1',
          name: 'Test Key',
          scopes: ['analytics:read'],
        },
        'user-1',
      );

      expect(result.key).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(result.key_prefix).toBe(result.key.substring(0, 15));
      expect(result.name).toBe('Test Key');
      expect(result.scopes).toEqual(['analytics:read']);
    });

    it('should reject invalid scopes', async () => {
      await expect(
        service.create(
          {
            workspaceId: 'ws-1',
            name: 'Test Key',
            scopes: ['invalid:scope' as any],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('authenticate', () => {
    it('should authenticate valid API key', async () => {
      const { key, hash, prefix } = require('../common/crypto').generateApiKey();

      clickhouse.querySystem.mockResolvedValue([{
        id: 'key-1',
        key_hash: hash,
        key_prefix: prefix,
        user_id: 'user-1',
        scopes: JSON.stringify(['analytics:read']),
        status: 'active',
      }]);

      const result = await service.authenticate(`Bearer ${key}`);

      expect(result).not.toBeNull();
      expect(result?.user.id).toBe('user-1');
      expect(result?.scopes).toEqual(['analytics:read']);
    });

    it('should reject invalid API key', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.authenticate('Bearer sk_live_invalid');

      expect(result).toBeNull();
    });

    it('should reject non-API key auth headers', async () => {
      const result = await service.authenticate('Bearer jwt-token');

      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('should revoke an API key', async () => {
      clickhouse.querySystem.mockResolvedValue([{
        id: 'key-1',
        status: 'active',
      }]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.revoke('key-1', 'user-1');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'api_keys',
        expect.arrayContaining([
          expect.objectContaining({
            status: 'revoked',
            revoked_by: 'user-1',
          }),
        ]),
      );
    });

    it('should throw NotFoundException for non-existent key', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(service.revoke('non-existent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('hasScope', () => {
    it('should return true when scope is present', () => {
      expect(service.hasScope(['analytics:read', 'analytics:write'], 'analytics:read')).toBe(true);
    });

    it('should return false when scope is missing', () => {
      expect(service.hasScope(['analytics:read'], 'workspace:manage')).toBe(false);
    });
  });
});
```

---

## Deliverables Checklist

- [ ] `api/src/api-keys/api-keys.module.ts`
- [ ] `api/src/api-keys/api-keys.service.ts`
- [ ] `api/src/api-keys/api-keys.controller.ts`
- [ ] `api/src/api-keys/guards/api-key.guard.ts`
- [ ] `api/src/api-keys/decorators/require-scope.decorator.ts`
- [ ] `api/src/api-keys/dto/create-api-key.dto.ts`
- [ ] `api/src/api-keys/dto/update-api-key.dto.ts`
- [ ] `api/src/api-keys/api-keys.service.spec.ts`
- [ ] Module registered in `app.module.ts`
- [ ] All tests passing
- [ ] OpenAPI spec updated

---

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `apiKeys.list` | GET | Yes | List workspace API keys |
| `apiKeys.get` | GET | Yes | Get key details (not key itself) |
| `apiKeys.create` | POST | Yes | Create new key (returns key once) |
| `apiKeys.update` | POST | Yes | Update name, description, scopes |
| `apiKeys.revoke` | POST | Yes | Revoke an API key |
| `apiKeys.rotate` | POST | Yes | Revoke old + create new |

---

## Acceptance Criteria

1. API keys are generated with `sk_live_` prefix
2. Full key is returned only once at creation
3. Keys are stored as SHA-256 hashes
4. Prefix lookup enables efficient authentication
5. Constant-time comparison prevents timing attacks
6. Failed attempts are tracked
7. Keys can have expiration dates
8. Scopes are validated against allowed list
9. Revoked keys cannot be used
10. Key rotation works atomically
11. Service accounts are created for each API key
12. Unit tests have >80% coverage

---

## Usage Example

```typescript
// Creating an API key
const response = await fetch('/api/apiKeys.create', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${jwtToken}` },
  body: JSON.stringify({
    workspaceId: 'ws-123',
    name: 'Production SDK',
    scopes: ['analytics:write', 'analytics:read'],
  }),
});

const { key } = await response.json();
// key = "sk_live_abc123..." - save this, it won't be shown again!

// Using the API key
const analyticsResponse = await fetch('/api/events', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${key}` },
  body: JSON.stringify({ /* event data */ }),
});
```
