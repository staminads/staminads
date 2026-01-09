# Authentication & Authorization Enforcement Report

> Generated: 2026-01-09

## Executive Summary

The Staminads API implements a **multi-layered authentication and authorization system** with two authentication mechanisms (JWT for users, API keys for programmatic access), role-based access control (RBAC) with 4 roles, and granular API key scopes.

---

## 1. Authentication Mechanisms

### JWT Authentication (User Sessions)

| Aspect | Details |
|--------|---------|
| **Strategy File** | `api/src/auth/strategies/jwt.strategy.ts` |
| **Token Location** | Bearer token in Authorization header |
| **Secret** | `ENCRYPTION_KEY` environment variable |
| **TTL** | Configured via `JWT_EXPIRES_IN` (default: 7d) |
| **Session Support** | Yes, with revocation capability |
| **Caching** | 5-minute user cache for performance |

**Validation Flow**:
1. Check if `sessionId` exists in JWT payload
2. Validate session is still active (not revoked, not expired)
3. Load user from cache (5-minute TTL) or database
4. Verify user status is `active` and not deleted
5. Return user object with `id`, `email`, `name`, and `isSuperAdmin` flag

**JWT Payload Structure**:
```typescript
interface JwtPayload {
  sub: string;        // user ID
  email: string;
  sessionId?: string; // optional session reference
}
```

### API Key Authentication (Programmatic Access)

| Aspect | Details |
|--------|---------|
| **Strategy File** | `api/src/auth/strategies/api-key.strategy.ts` |
| **Token Prefix** | `stam_live_*` |
| **Storage** | Hash only (`key_hash` column) |
| **Workspace Binding** | Each key bound to single workspace |
| **Usage Tracking** | `last_used_at` updated asynchronously |

**Validation Flow**:
1. Verify token starts with `stam_live_` prefix
2. Hash token and lookup by `key_hash` in database
3. Verify status is `active` (not `revoked` or `expired`)
4. Check expiry date if `expires_at` is set
5. Verify API key is bound to a workspace
6. Update `last_used_at` asynchronously (fire-and-forget)
7. Return scopes array for scope validation

**API Key Payload Structure**:
```typescript
interface ApiKeyPayload {
  type: 'api-key';
  keyId: string;
  workspaceId: string;
  scopes: ApiScope[];
}
```

---

## 2. Global Guard Chain

**File**: `api/src/common/common.module.ts`

```
Request → ThrottlerGuard → JwtAuthGuard → [Route Handler]
```

Guards are registered globally in this order:
1. **CustomThrottlerGuard** (first) - Rate limiting before auth
2. **JwtAuthGuard** (second) - JWT validation for all routes

```typescript
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,  // Runs FIRST
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // Runs SECOND
    },
  ],
})
```

### JwtAuthGuard Flow

**File**: `api/src/common/guards/jwt-auth.guard.ts`

```typescript
canActivate(context: ExecutionContext) {
  // 1. Check if route is marked @Public()
  if (isPublic) return true;

  // 2. Check if route is marked @RequireScope() (API key route)
  if (isApiKeyRoute) return true;

  // 3. Otherwise, validate JWT
  return super.canActivate(context);
}
```

**Public routes** (marked with `@Public()` decorator):
- `POST /api/auth.login`
- `POST /api/auth.forgotPassword`
- `POST /api/auth.resetPassword`
- `POST /api/track` (event tracking)
- `POST /api/demo.generate` (with DemoProtected guard)
- `POST /api/demo.delete` (with DemoProtected guard)

---

## 3. Role-Based Access Control (RBAC)

### Role Hierarchy

**Database Schema**: `api/src/database/schemas/002_users.sql`

| Role | Level | Description |
|------|-------|-------------|
| `owner` | 4 | Highest privilege - full control |
| `admin` | 3 | Settings, API keys, member management |
| `editor` | 2 | Filters, annotations, analytics export |
| `viewer` | 1 | Analytics view only |

### Permission Matrix

**File**: `api/src/common/permissions.ts`

```typescript
const PERMISSIONS = {
  // Analytics
  'analytics.view': ['owner', 'admin', 'editor', 'viewer'],
  'analytics.export': ['owner', 'admin', 'editor'],

  // Filters & Annotations
  'filters.manage': ['owner', 'admin', 'editor'],
  'annotations.manage': ['owner', 'admin', 'editor'],

  // Integrations
  'integrations.manage': ['owner', 'admin'],

  // Workspace settings
  'workspace.settings': ['owner', 'admin'],
  'workspace.smtp': ['owner'],
  'workspace.delete': ['owner'],

  // API Keys
  'apiKeys.view': ['owner', 'admin'],
  'apiKeys.manage': ['owner', 'admin'],

  // Team management
  'members.invite': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'members.remove': ['owner', 'admin'],
  'ownership.transfer': ['owner'],
}
```

### Super Admin System

**Database Column**: `users.is_super_admin` (UInt8, default 0)

Super admins have special privileges:
- Can access ANY workspace without being a member
- Automatically treated as `owner` role for permission checks
- Detected in `JwtStrategy.validate()` and `WorkspaceAuthGuard`

**Implementation** (`api/src/common/guards/workspace.guard.ts:64-78`):

```typescript
// Super admins can access any workspace
if (user.isSuperAdmin) {
  // Create synthetic owner membership for permission checks
  request.membership = {
    id: 'super-admin',
    role: 'owner',
    // ... other fields
  };
  return true;
}
```

---

## 4. Authorization Guards & Decorators

### WorkspaceAuthGuard (Unified Workspace Access Control)

**File**: `api/src/common/guards/workspace.guard.ts`

This guard handles BOTH JWT and API key authentication for workspace-scoped routes.

**Workspace ID Extraction**:
- Checks `request.body.workspace_id` (POST requests)
- Checks `request.body.id` (workspaces controller context)
- Checks `request.query.workspace_id` (GET requests)
- Supports both snake_case and camelCase variants

**For API Keys**:
- Validates `workspace_id` in request matches the API key's bound workspace
- Throws `ForbiddenException` if mismatch

**For JWT Users**:
- Queries `workspace_memberships` table to verify user is a member
- Throws `ForbiddenException` if not a member
- Attaches membership to `request.membership` for permission checks

**Permission Checking**:
```typescript
// Check @RequirePermission() decorator if present
if (requiredPermission && !hasPermission(membership.role, requiredPermission)) {
  throw new ForbiddenException('Insufficient permissions');
}
```

### ScopeGuard (API Key Scope Validation)

**File**: `api/src/common/guards/scope.guard.ts`

Validates API key has required scopes for the route:

```typescript
canActivate(context: ExecutionContext): boolean {
  const requiredScopes = this.reflector.getAllAndOverride<ApiScope[]>(
    REQUIRED_SCOPES_KEY,
    [context.getHandler(), context.getClass()],
  );

  // API key must have at least one of the required scopes
  const hasScope = requiredScopes.some((scope) =>
    user.scopes.includes(scope),
  );

  if (!hasScope) {
    throw new ForbiddenException(
      `Missing required scope: ${requiredScopes.join(' or ')}`,
    );
  }

  return true;
}
```

### DemoRestrictedGuard

**File**: `api/src/common/guards/demo-restricted.guard.ts`

Prevents write operations when `IS_DEMO=true` environment variable is set.

### DemoSecretGuard

**File**: `api/src/demo/guards/demo-secret.guard.ts`

Protects demo endpoints with timing-safe comparison:
- Requires `?secret=<DEMO_SECRET>` query parameter
- Uses `timingSafeEqual()` from Node crypto to prevent timing attacks
- Throws `UnauthorizedException` if secret is missing or invalid

---

## 5. Decorators Reference

**Location**: `api/src/common/decorators/`

| Decorator | Purpose | Usage |
|-----------|---------|-------|
| `@Public()` | Mark route as public (no JWT required) | Login, track endpoints |
| `@RequireScope(...scopes)` | Set required API key scopes | API key routes |
| `@RequirePermission(perm)` | Set required role permission | Protected workspace routes |
| `@DemoRestricted()` | Block in demo mode | Write operations |
| `@DemoProtected()` | Require `?secret=` param | Demo management endpoints |

### @Public()

**File**: `api/src/common/decorators/public.decorator.ts`

Marks routes as public (no JWT required):

```typescript
@Public()
@Post('auth.login')
async login(@Body() dto: LoginDto) { }
```

### @RequireScope(...scopes)

**File**: `api/src/common/decorators/require-scope.decorator.ts`

Marks routes as API key routes and sets required scopes:

```typescript
@RequireScope('events.track')
@UseGuards(AuthGuard('api-key'), ScopeGuard)
async track(@Body() dto: TrackEventDto) { }
```

### @RequirePermission(permission)

**File**: `api/src/common/decorators/require-permission.decorator.ts`

Sets required permission for role-based access (used with `WorkspaceAuthGuard`):

```typescript
@UseGuards(WorkspaceAuthGuard)
@RequirePermission('workspace.delete')
@Post('workspaces.delete')
delete(@Body('id') id: string) { }
```

---

## 6. API Key Scopes

### Scope Definitions

**File**: `api/src/common/entities/api-key.entity.ts`

```typescript
export const API_SCOPES = {
  'events.track': 'Send session and event data via SDK',
  'analytics.view': 'Query analytics data',
  'analytics.export': 'Export analytics data',
  'workspace.read': 'Read workspace configuration',
  'filters.manage': 'Create and manage filters',
  'annotations.manage': 'Create and manage annotations',
}
```

### Scope-to-Permission Mapping

```typescript
export const SCOPE_TO_PERMISSION: Record<ApiScope, Permission | null> = {
  'events.track': null,           // Anyone can grant
  'analytics.view': 'analytics.view',
  'analytics.export': 'analytics.export',
  'workspace.read': 'analytics.view',
  'filters.manage': 'filters.manage',
  'annotations.manage': 'annotations.manage',
}
```

### Scope Validation During API Key Creation

**File**: `api/src/api-keys/api-keys.service.ts:320-354`

Users cannot grant scopes they don't have permission for:

```typescript
async validateScopesForUser(
  workspaceId: string,
  userId: string,
  scopes: ApiScope[],
): Promise<void> {
  const membership = await this.membersService.getMembership(
    workspaceId,
    userId,
  );

  // 1. Check integrations.manage permission (required to create API keys)
  if (!hasPermission(membership.role, 'integrations.manage')) {
    throw new ForbiddenException(
      'Insufficient permissions to create API keys',
    );
  }

  // 2. Validate each requested scope
  for (const scope of scopes) {
    const requiredPermission = SCOPE_TO_PERMISSION[scope];

    if (requiredPermission === null) continue;  // null means anyone can grant

    if (!hasPermission(membership.role, requiredPermission)) {
      throw new ForbiddenException(
        `Cannot grant scope '${scope}': missing '${requiredPermission}' permission`,
      );
    }
  }
}
```

---

## 7. Database Schemas

### Users Table

**File**: `api/src/database/schemas/002_users.sql`

```sql
CREATE TABLE IF NOT EXISTS users (
    id String,
    email String,
    password_hash Nullable(String),
    name String,
    type Enum8('user' = 1, 'service_account' = 2) DEFAULT 'user',
    status Enum8('pending' = 1, 'active' = 2, 'disabled' = 3),
    is_super_admin UInt8 DEFAULT 0,
    last_login_at Nullable(DateTime64(3)),
    failed_login_attempts UInt8 DEFAULT 0,
    locked_until Nullable(DateTime64(3)),
    password_changed_at Nullable(DateTime64(3)),
    deleted_at Nullable(DateTime64(3)),
    deleted_by Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

### Sessions Table

Tracks active sessions for "logout all devices" functionality:

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id String,
    user_id String,
    token_hash String,
    ip_address Nullable(String),
    user_agent Nullable(String),
    expires_at DateTime64(3),
    revoked_at Nullable(DateTime64(3)),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, id);
```

### Workspace Memberships Table

Links users to workspaces with roles:

```sql
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id String,
    workspace_id String,
    user_id String,
    role Enum8('owner' = 1, 'admin' = 2, 'editor' = 3, 'viewer' = 4),
    invited_by Nullable(String),
    joined_at DateTime64(3) DEFAULT now64(3),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (workspace_id, user_id);
```

### API Keys Table

```sql
CREATE TABLE IF NOT EXISTS api_keys (
    id String,
    key_hash String,
    key_prefix String,
    user_id String,
    workspace_id Nullable(String),
    name String,
    description String DEFAULT '',
    scopes String,  -- JSON array
    status Enum8('active' = 1, 'revoked' = 2, 'expired' = 3) DEFAULT 'active',
    expires_at Nullable(DateTime64(3)),
    last_used_at Nullable(DateTime64(3)),
    failed_attempts_count UInt8 DEFAULT 0,
    last_failed_attempt_at Nullable(DateTime64(3)),
    created_by String,
    revoked_by Nullable(String),
    revoked_at Nullable(DateTime64(3)),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

---

## 8. Protected Routes Examples

### Example 1: Workspace Operations

**File**: `api/src/workspaces/workspaces.controller.ts`

```typescript
@ApiTags('workspaces')
@ApiSecurity('jwt-auth')  // Entire controller needs JWT
@Controller('api')
export class WorkspacesController {
  // Requires workspace membership + workspace.settings permission
  @Post('workspaces.update')
  @DemoRestricted()  // Cannot run in demo mode
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('workspace.settings')
  update(@Body() dto: UpdateWorkspaceDto) { }

  // Requires workspace membership + workspace.delete permission
  @Post('workspaces.delete')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('workspace.delete')
  async delete(@Body('id') id: string) { }
}
```

### Example 2: Event Tracking (Public)

**File**: `api/src/events/events.controller.ts`

```typescript
@SkipRateLimit()  // High-volume SDK endpoint
@ApiTags('events')
@Controller('api')
export class EventsController {
  @Post('track')
  @HttpCode(200)
  @Public()  // No authentication required
  @ApiOperation({ summary: 'Track session with cumulative actions array' })
  async track(
    @Body() payload: SessionPayloadDto,
    @ClientIp() clientIp: string | null,
  ) { }
}
```

### Example 3: Analytics with Workspace Guard

**File**: `api/src/analytics/analytics.controller.ts`

```typescript
@ApiTags('analytics')
@ApiSecurity('jwt-auth')
@SkipRateLimit()  // Uses caching instead
@Controller('api')
export class AnalyticsController {
  @Post('analytics.query')
  @HttpCode(200)
  @UseGuards(WorkspaceAuthGuard)  // Verifies workspace membership
  @ApiOperation({ summary: 'Execute an analytics query' })
  async query(@Body() dto: AnalyticsQueryDto) { }
}
```

### Example 4: API Key Management

**File**: `api/src/api-keys/api-keys.controller.ts`

```typescript
@ApiTags('api-keys')
@ApiSecurity('jwt-auth')
@Controller('api')
export class ApiKeysController {
  @Post('apiKeys.create')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('apiKeys.manage')  // Only owner/admin
  @ApiOperation({ summary: 'Create a new API key' })
  async create(
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request & { user?: { id: string } },
  ): Promise<CreateApiKeyResponseDto> { }
}
```

---

## 9. Security Features

### Rate Limiting

**File**: `api/src/common/throttler/throttler.guard.ts`

Three throttler buckets configured in `app.module.ts`:

| Bucket | TTL | Limit | Purpose |
|--------|-----|-------|---------|
| `auth` | 60s | 10 req | Auth endpoints |
| `default` | 60s | 100 req | General endpoints |
| `analytics` | 60s | 1000 req | High-volume analytics |

### Account Lockout

- Failed login attempts tracked in `users.failed_login_attempts`
- Account locked for 15 minutes after repeated failures
- Verified in `AuthService.login()`

### Password Reset Security

- Reset tokens expire after 1 hour
- Reset tokens are hashed (only hash stored)
- Rate limited to 3 requests per hour per user
- Always returns success (prevents email enumeration)

### Demo Secret Protection

- Uses `timingSafeEqual()` from Node crypto module
- Prevents timing attacks on secret comparison

### Session Management

- Sessions expire after 7 days (configurable)
- Users can revoke individual sessions or all sessions
- Session token is hashed in database (only hash stored)

---

## 10. Key Files Reference

| File Path | Purpose |
|-----------|---------|
| `api/src/common/guards/jwt-auth.guard.ts` | Global JWT validation, checks for @Public() |
| `api/src/common/guards/workspace.guard.ts` | Workspace membership & permission checks |
| `api/src/common/guards/scope.guard.ts` | API key scope validation |
| `api/src/common/decorators/public.decorator.ts` | Mark routes as public |
| `api/src/common/decorators/require-scope.decorator.ts` | Set required API key scopes |
| `api/src/common/decorators/require-permission.decorator.ts` | Set required role permission |
| `api/src/common/permissions.ts` | RBAC matrix definition |
| `api/src/common/entities/api-key.entity.ts` | API scope definitions & mapping |
| `api/src/auth/strategies/jwt.strategy.ts` | JWT validation logic |
| `api/src/auth/strategies/api-key.strategy.ts` | API key validation logic |
| `api/src/auth/auth.service.ts` | Login, session, password reset |
| `api/src/api-keys/api-keys.service.ts` | API key creation with scope validation |
| `api/src/database/schemas/002_users.sql` | Database schema for users/roles/keys |
| `api/src/common/common.module.ts` | Global guard registration |

---

## 11. Summary of Enforcement

| Layer | Mechanism | Description |
|-------|-----------|-------------|
| **Default Protection** | `JwtAuthGuard` (global) | All routes protected by default |
| **Public Routes** | `@Public()` decorator | Explicit opt-out of JWT check |
| **API Key Routes** | `@RequireScope()` decorator | Marks routes as API key authenticated |
| **Workspace Isolation** | `WorkspaceAuthGuard` | Verifies membership or API key binding |
| **Role Permissions** | `@RequirePermission()` + RBAC matrix | Permission-based access control |
| **Scope Enforcement** | `ScopeGuard` | Validates API key scopes per-request |
| **Scope Delegation** | `validateScopesForUser()` | Cannot grant scopes beyond own permissions |
| **Super Admin** | `is_super_admin` flag | Platform-level access override |
| **Demo Protection** | `DemoRestrictedGuard` | Blocks writes in demo mode |
| **Rate Limiting** | `ThrottlerGuard` | Different limits per endpoint category |

---

## 12. Security Considerations

### Strengths

1. **Defense in depth** - Multiple layers of guards
2. **Fail-secure** - All routes protected by default
3. **Principle of least privilege** - Granular permissions and scopes
4. **Scope delegation control** - Users cannot grant scopes beyond their permissions
5. **Timing-safe comparisons** - For demo secret validation
6. **Session revocation** - Support for "logout all devices"
7. **Account lockout** - Protection against brute force

### Recommendations

1. Consider adding audit logging for permission checks
2. Consider implementing refresh tokens for JWT
3. Consider adding IP-based restrictions for API keys
4. Consider implementing API key rotation mechanism
