# Phase 0: Foundation Implementation Plan

**Track:** Foundation (Sequential)
**Dependencies:** None
**Blocks:** All other tracks

---

## Overview

This phase establishes the database schema, shared utilities, and TypeScript interfaces that all other modules depend on. Must be completed before parallel work begins.

---

## Task 1: Database Schema

**File:** `api/src/database/schemas/002_users.sql`

### 1.1 Users Table

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

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) TYPE bloom_filter GRANULARITY 1;
```

### 1.2 Sessions Table

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

### 1.3 Workspace Memberships Table

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

### 1.4 Invitations Table

```sql
CREATE TABLE IF NOT EXISTS invitations (
    id String,
    workspace_id String,
    email String,
    role Enum8('admin' = 2, 'editor' = 3, 'viewer' = 4),
    token_hash String,
    invited_by String,
    status Enum8('pending' = 1, 'accepted' = 2, 'expired' = 3, 'revoked' = 4),
    expires_at DateTime64(3),
    accepted_at Nullable(DateTime64(3)),
    revoked_at Nullable(DateTime64(3)),
    revoked_by Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

### 1.5 Password Reset Tokens Table

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id String,
    user_id String,
    token_hash String,
    status Enum8('pending' = 1, 'used' = 2, 'expired' = 3),
    expires_at DateTime64(3),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

### 1.6 Audit Logs Table

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id String,
    user_id String,
    workspace_id Nullable(String),
    action String,
    target_type String,
    target_id String,
    metadata String,
    ip_address Nullable(String),
    user_agent Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at)
TTL created_at + INTERVAL 90 DAY;
```

### 1.7 API Keys Table

```sql
CREATE TABLE IF NOT EXISTS api_keys (
    id String,
    key_hash String,
    key_prefix String,
    user_id String,
    workspace_id Nullable(String),
    name String,
    description String DEFAULT '',
    scopes String,
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

-- Index for prefix lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix) TYPE bloom_filter GRANULARITY 1;
```

---

## Task 2: Crypto Utilities

**File:** `api/src/common/crypto.ts`

```typescript
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

/**
 * Generate a secure random token with its SHA-256 hash
 * Used for invitations, password resets, API keys
 */
export function generateToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Generate an API key with prefix
 * Format: sk_live_<64 hex chars>
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const key = `sk_live_${randomPart}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 15); // "sk_live_" + 7 chars
  return { key, hash, prefix };
}

/**
 * Hash a token using SHA-256
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify a token against a stored hash using constant-time comparison
 */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  const computedHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}
```

### Test File: `api/src/common/crypto.spec.ts`

```typescript
import {
  generateToken,
  generateApiKey,
  hashToken,
  verifyTokenHash,
  hashPassword,
  verifyPassword,
  generateId,
} from './crypto';

describe('Crypto Utilities', () => {
  describe('generateToken', () => {
    it('should generate a 64-char hex token', () => {
      const { token } = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate a valid SHA-256 hash', () => {
      const { token, hash } = generateToken();
      expect(hash).toHaveLength(64);
      expect(verifyTokenHash(token, hash)).toBe(true);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateToken().token));
      expect(tokens.size).toBe(100);
    });
  });

  describe('generateApiKey', () => {
    it('should generate key with sk_live_ prefix', () => {
      const { key, prefix } = generateApiKey();
      expect(key).toMatch(/^sk_live_[a-f0-9]{64}$/);
      expect(prefix).toBe(key.substring(0, 15));
    });
  });

  describe('verifyTokenHash', () => {
    it('should return true for matching token', () => {
      const { token, hash } = generateToken();
      expect(verifyTokenHash(token, hash)).toBe(true);
    });

    it('should return false for wrong token', () => {
      const { hash } = generateToken();
      expect(verifyTokenHash('wrong-token', hash)).toBe(false);
    });

    it('should be timing-safe', () => {
      const { hash } = generateToken();
      // Should not throw on invalid hex
      expect(verifyTokenHash('invalid', hash)).toBe(false);
    });
  });

  describe('password hashing', () => {
    it('should hash and verify password', async () => {
      const password = 'SecurePassword123!';
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it('should reject wrong password', async () => {
      const hash = await hashPassword('correct');
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'test123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateId', () => {
    it('should generate valid UUID v4', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });
});
```

---

## Task 3: Shared Entities and Constants

### 3.1 User Entity

**File:** `api/src/common/entities/user.entity.ts`

```typescript
export type UserType = 'user' | 'service_account';
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  type: UserType;
  status: UserStatus;
  is_super_admin: boolean;
  last_login_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'status' | 'created_at'>;
```

### 3.2 Membership Entity

**File:** `api/src/common/entities/membership.entity.ts`

```typescript
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface WorkspaceMembership {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface MemberWithUser extends WorkspaceMembership {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
}
```

### 3.3 Invitation Entity

**File:** `api/src/common/entities/invitation.entity.ts`

```typescript
import { Role } from './membership.entity';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
  id: string;
  workspace_id: string;
  email: string;
  role: Exclude<Role, 'owner'>; // Can't invite as owner
  token_hash: string;
  invited_by: string;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvitationWithInviter extends Invitation {
  inviter: {
    id: string;
    name: string;
    email: string;
  };
}
```

### 3.4 API Key Entity

**File:** `api/src/common/entities/api-key.entity.ts`

```typescript
export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

export const API_SCOPES = {
  'analytics:write': 'Send session and event data',
  'analytics:read': 'Query analytics data',
  'workspace:read': 'Read workspace info',
  'workspace:manage': 'Update workspace settings',
} as const;

export type ApiScope = keyof typeof API_SCOPES;

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  scopes: ApiScope[];
  status: ApiKeyStatus;
  expires_at: string | null;
  last_used_at: string | null;
  failed_attempts_count: number;
  last_failed_attempt_at: string | null;
  created_by: string;
  revoked_by: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicApiKey = Omit<ApiKey, 'key_hash'>;
```

### 3.5 Audit Log Entity

**File:** `api/src/common/entities/audit-log.entity.ts`

```typescript
export const AUDIT_ACTIONS = {
  // Invitations
  'invitation.sent': 'Invitation created and email sent',
  'invitation.accepted': 'User accepted invitation',
  'invitation.revoked': 'Invitation revoked by admin',
  'invitation.expired': 'Invitation expired',

  // Members
  'member.added': 'Member added to workspace',
  'member.role_changed': 'Member role updated',
  'member.removed': 'Member removed from workspace',
  'member.left': 'Member left workspace voluntarily',

  // Password
  'password.reset_requested': 'Password reset email sent',
  'password.changed': 'Password changed',

  // API Keys
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface AuditLog {
  id: string;
  user_id: string;
  workspace_id: string | null;
  action: AuditAction;
  target_type: 'user' | 'invitation' | 'membership' | 'api_key';
  target_id: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
```

### 3.6 Session Entity

**File:** `api/src/common/entities/session.entity.ts`

```typescript
export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicSession = Omit<Session, 'token_hash'>;
```

### 3.7 Permissions Constants

**File:** `api/src/common/permissions.ts`

```typescript
import { Role } from './entities/membership.entity';

export const PERMISSIONS = {
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

  // Team management
  'members.invite': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'members.remove': ['owner', 'admin'],
  'ownership.transfer': ['owner'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Check if a user has a specific permission based on their role
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles.includes(role);
}

/**
 * Check if actor can modify target based on role hierarchy
 * Returns true if actor's role is higher than target's role
 */
export function canModifyMember(actorRole: Role, targetRole: Role): boolean {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return Object.entries(PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([permission]) => permission as Permission);
}
```

### 3.8 Index File

**File:** `api/src/common/entities/index.ts`

```typescript
export * from './user.entity';
export * from './membership.entity';
export * from './invitation.entity';
export * from './api-key.entity';
export * from './audit-log.entity';
export * from './session.entity';
```

---

## Task 4: Update Database Service

**File:** `api/src/database/clickhouse.service.ts` (modify)

Add method to run migrations:

```typescript
async runMigrations(): Promise<void> {
  const schemasDir = path.join(__dirname, 'schemas');
  const files = fs.readdirSync(schemasDir).sort();

  for (const file of files) {
    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(schemasDir, file), 'utf-8');
      const statements = sql.split(';').filter(s => s.trim());

      for (const statement of statements) {
        await this.commandSystem(statement);
      }

      this.logger.log(`Applied migration: ${file}`);
    }
  }
}
```

---

## Deliverables Checklist

- [ ] `api/src/database/schemas/002_users.sql` - All 7 tables
- [ ] `api/src/common/crypto.ts` - Token/password utilities
- [ ] `api/src/common/crypto.spec.ts` - Unit tests
- [ ] `api/src/common/entities/user.entity.ts`
- [ ] `api/src/common/entities/membership.entity.ts`
- [ ] `api/src/common/entities/invitation.entity.ts`
- [ ] `api/src/common/entities/api-key.entity.ts`
- [ ] `api/src/common/entities/audit-log.entity.ts`
- [ ] `api/src/common/entities/session.entity.ts`
- [ ] `api/src/common/entities/index.ts`
- [ ] `api/src/common/permissions.ts`
- [ ] Database migration method updated
- [ ] All tests passing

---

## Acceptance Criteria

1. Running `npm run start:dev` applies all migrations without errors
2. All 7 tables exist in ClickHouse with correct schema
3. Crypto utilities have 100% test coverage
4. All entity types are exported and importable
5. Permission helpers work correctly for all role combinations
