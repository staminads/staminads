# User Invitation System Specification

## Overview

This document specifies the user invitation and collaboration system for Staminads workspaces. The system enables workspace owners to invite team members via email, with granular role-based permissions.

---

## 1. Data Models

### 1.1 Users Table (ClickHouse)

Global user accounts that can belong to multiple workspaces.

```sql
CREATE TABLE IF NOT EXISTS users (
    id String,                              -- UUID
    email String,                           -- Unique email address
    password_hash Nullable(String),         -- bcrypt hashed password (NULL for service accounts)
    name String,                            -- Display name
    type Enum8('user' = 1, 'service_account' = 2) DEFAULT 1,
    status Enum8('pending' = 1, 'active' = 2, 'disabled' = 3),
    is_super_admin UInt8 DEFAULT 0,         -- Boolean: can create workspaces (first admin only)
    last_login_at Nullable(DateTime64(3)),  -- Track last login
    failed_login_attempts UInt8 DEFAULT 0,  -- For rate limiting
    locked_until Nullable(DateTime64(3)),   -- Account lockout
    password_changed_at Nullable(DateTime64(3)),
    deleted_at Nullable(DateTime64(3)),          -- Soft delete
    deleted_by Nullable(String),                 -- Who deleted
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

### 1.2 Sessions Table

Track active sessions for "logout all devices" functionality.

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id String,                              -- UUID
    user_id String,
    token_hash String,                      -- SHA-256 hash of session token
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

Links users to workspaces with roles.

```sql
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id String,                              -- UUID
    workspace_id String,
    user_id String,
    role Enum8('owner' = 1, 'admin' = 2, 'editor' = 3, 'viewer' = 4),
    invited_by Nullable(String),            -- User ID who added this member
    joined_at DateTime64(3) DEFAULT now64(3),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (workspace_id, user_id);
```

### 1.4 Invitations Table

Pending invitations with secure tokens.

```sql
CREATE TABLE IF NOT EXISTS invitations (
    id String,                              -- UUID
    workspace_id String,
    email String,                           -- Invited email
    role Enum8('admin' = 2, 'editor' = 3, 'viewer' = 4),
    token_hash String,                      -- SHA-256 hash of token
    invited_by String,                      -- User ID who sent invitation
    status Enum8('pending' = 1, 'accepted' = 2, 'expired' = 3, 'revoked' = 4),
    expires_at DateTime64(3),               -- Token expiration (7 days default)
    accepted_at Nullable(DateTime64(3)),    -- When accepted
    revoked_at Nullable(DateTime64(3)),     -- When revoked
    revoked_by Nullable(String),            -- Who revoked
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

### 1.5 Password Reset Tokens Table

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id String,                              -- UUID
    user_id String,
    token_hash String,                      -- SHA-256 hash of token (never store plaintext)
    status Enum8('pending' = 1, 'used' = 2, 'expired' = 3),
    expires_at DateTime64(3),               -- Token expiration (1 hour)
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

### 1.6 Audit Logs Table

Track invitation and membership changes for compliance and debugging.

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id String,                              -- UUID
    user_id String,                         -- Who performed the action
    workspace_id Nullable(String),          -- Which workspace (if applicable)
    action String,                          -- 'invitation.sent', 'invitation.accepted', 'member.role_changed', etc.
    target_type String,                     -- 'user', 'invitation', 'membership'
    target_id String,                       -- ID of the affected entity
    metadata String,                        -- JSON with action details
    ip_address Nullable(String),
    user_agent Nullable(String),
    created_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at)
TTL created_at + INTERVAL 90 DAY;          -- Auto-delete after 90 days
```

**Audit Actions:**
- `invitation.sent` - Invitation created and email sent
- `invitation.accepted` - User accepted invitation
- `invitation.revoked` - Invitation revoked by admin
- `invitation.expired` - Invitation expired (background job)
- `member.added` - Member added to workspace
- `member.role_changed` - Member role updated
- `member.removed` - Member removed from workspace
- `member.left` - Member left workspace voluntarily
- `password.reset_requested` - Password reset email sent
- `password.changed` - Password changed
- `api_key.created` - API key created
- `api_key.revoked` - API key revoked

### 1.7 API Keys Table

API keys for programmatic access, linked to service accounts.

```sql
CREATE TABLE IF NOT EXISTS api_keys (
    id String,                              -- UUID (displayed as key_xxx)
    key_hash String,                        -- SHA-256 hash of actual key
    key_prefix String,                      -- First 15 chars for lookup (e.g., 'sk_live_abc1234')

    -- Ownership
    user_id String,                         -- Links to service account in users table
    workspace_id Nullable(String),          -- NULL = user-level key (cross-workspace)

    -- Metadata
    name String,                            -- User-friendly name (e.g., 'Production SDK')
    description String DEFAULT '',

    -- Permissions
    scopes String,                          -- JSON array: ['analytics:write', 'analytics:read']

    -- Status & Security
    status Enum8('active' = 1, 'revoked' = 2, 'expired' = 3) DEFAULT 1,
    expires_at Nullable(DateTime64(3)),
    last_used_at Nullable(DateTime64(3)),

    -- Rate limiting
    failed_attempts_count UInt8 DEFAULT 0,
    last_failed_attempt_at Nullable(DateTime64(3)),

    -- Audit
    created_by String,                      -- User ID who created the key
    revoked_by Nullable(String),
    revoked_at Nullable(DateTime64(3)),
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;
```

**API Key Format:**
```
sk_test_AbCdEf1234567890abcdef1234567890
└─┬──┘ └─────────────┬────────────────┘
prefix          random (32 bytes hex)
```

**Scopes:**
```typescript
const API_SCOPES = {
  'analytics:write': 'Send session and event data',
  'analytics:read': 'Query analytics data',
  'workspace:read': 'Read workspace info',
  'workspace:manage': 'Update workspace settings',
} as const;
```

### 1.8 SMTP Settings (in WorkspaceSettings)

Add to existing `WorkspaceSettings` interface:

```typescript
interface SmtpSettings {
  enabled: boolean;
  host: string;                    // e.g., 'smtp.gmail.com'
  port: number;                    // e.g., 587
  tls: boolean;                    // Use TLS encryption
  username?: string;               // Optional - some SMTP servers don't require auth
  password_encrypted?: string;     // Optional - encrypted with workspace key
  from_name: string;               // e.g., 'Staminads Analytics'
  from_email: string;              // e.g., 'noreply@company.com'
}

interface WorkspaceSettings {
  // ... existing fields ...
  smtp?: SmtpSettings;
}
```

---

## 2. User Roles & Permissions

### 2.1 Permission Matrix

| Permission | Owner | Admin | Editor | Viewer |
|------------|-------|-------|--------|--------|
| View dashboard & analytics | ✓ | ✓ | ✓ | ✓ |
| View live sessions | ✓ | ✓ | ✓ | ✓ |
| Export data | ✓ | ✓ | ✓ | ✗ |
| Create/edit filters | ✓ | ✓ | ✓ | ✗ |
| Create/edit annotations | ✓ | ✓ | ✓ | ✗ |
| Manage integrations | ✓ | ✓ | ✗ | ✗ |
| Manage workspace settings | ✓ | ✓ | ✗ | ✗ |
| Invite users | ✓ | ✓ | ✗ | ✗ |
| Manage user roles | ✓ | ✓ | ✗ | ✗ |
| Remove users | ✓* | ✓** | ✗ | ✗ |
| Configure SMTP | ✓ | ✗ | ✗ | ✗ |
| Delete workspace | ✓ | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ | ✗ |

*Owner can remove admins/editors/viewers. Owner cannot be removed by anyone (must transfer ownership first).
**Admins can remove editors and viewers only.

### 2.2 Permission Constants (for implementation)

```typescript
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
  'members.manage': ['owner', 'admin'],  // Change roles
  'members.remove': ['owner', 'admin'],  // With restrictions
  'ownership.transfer': ['owner'],
} as const;

// Role hierarchy for removal restrictions
export const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
} as const;

// Admins can only remove roles lower than their own
function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}
```

---

## 3. API Endpoints

### 3.1 Authentication (Updated)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth.login` | POST | No | Login with email/password |
| `/api/auth.register` | POST | No | Register new user (from invitation) |
| `/api/auth.me` | GET | Yes | Get current user profile |
| `/api/auth.updateProfile` | POST | Yes | Update name, email |
| `/api/auth.changePassword` | POST | Yes | Change password (requires current) |
| `/api/auth.forgotPassword` | POST | No | Request password reset email |
| `/api/auth.resetPassword` | POST | No | Reset password with token |
| `/api/auth.sessions` | GET | Yes | List active sessions |
| `/api/auth.revokeSession` | POST | Yes | Revoke a specific session |
| `/api/auth.revokeAllSessions` | POST | Yes | Logout all devices |

### 3.2 Invitations

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/invitations.list` | GET | Yes | List workspace invitations |
| `/api/invitations.create` | POST | Yes | Send invitation email |
| `/api/invitations.resend` | POST | Yes | Resend invitation email |
| `/api/invitations.revoke` | POST | Yes | Revoke pending invitation |
| `/api/invitations.get` | GET | No | Get invitation details by token |
| `/api/invitations.accept` | POST | No | Accept invitation (with/without account) |

### 3.3 Workspace Members

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/members.list` | GET | Yes | List workspace members |
| `/api/members.updateRole` | POST | Yes | Change member role |
| `/api/members.remove` | POST | Yes | Remove member from workspace |
| `/api/members.leave` | POST | Yes | Leave workspace (self) |
| `/api/members.transferOwnership` | POST | Yes | Transfer ownership to another member |

### 3.4 SMTP Settings

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/smtp.status` | GET | Yes | Check if SMTP is available (global or workspace) |
| `/api/smtp.get` | GET | Yes | Get SMTP settings (owner only) |
| `/api/smtp.update` | POST | Yes | Update SMTP settings (owner only) |
| `/api/smtp.delete` | POST | Yes | Remove workspace SMTP (fall back to global) |
| `/api/smtp.test` | POST | Yes | Send test email |

**`/api/smtp.status` Response:**
```typescript
{
  available: boolean;          // Can send emails
  source: 'workspace' | 'global' | 'none';
  from_email?: string;         // Configured from email
}
```

### 3.5 API Keys

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/apiKeys.list` | GET | Yes | List API keys for workspace |
| `/api/apiKeys.create` | POST | Yes | Create new API key (returns key once) |
| `/api/apiKeys.get` | GET | Yes | Get API key details (not the key itself) |
| `/api/apiKeys.update` | POST | Yes | Update name, description, scopes |
| `/api/apiKeys.revoke` | POST | Yes | Revoke an API key |
| `/api/apiKeys.rotate` | POST | Yes | Revoke old key and create new one |

**Create API Key Request:**
```typescript
{
  workspace_id: string;
  name: string;
  description?: string;
  scopes: string[];           // ['analytics:write', 'analytics:read']
  expires_at?: string;        // Optional expiration date
}
```

**Create API Key Response (only time key is shown):**
```typescript
{
  id: string;
  key: string;                // Full key - only returned once!
  key_prefix: string;
  name: string;
  scopes: string[];
  created_at: string;
}
```

---

## 4. User Flows

### 4.1 Invitation Flow (New User)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Admin clicks "Invite Member" in workspace settings          │
│ 2. Enters email and selects role                               │
│ 3. System creates invitation with secure token                 │
│ 4. System sends email via workspace SMTP                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. New user receives email with invitation link                │
│    Link: /invite/{token}                                       │
│ 6. User clicks link, sees workspace info & role                │
│ 7. User creates account (name, password)                       │
│ 8. System creates user, membership, marks invitation accepted  │
│ 9. User redirected to workspace dashboard                      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Invitation Flow (Existing User)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1-4. Same as above                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Existing user receives email with invitation link           │
│ 6. User clicks link, system recognizes email                   │
│ 7. If logged in: confirm to join workspace                     │
│    If logged out: login first, then confirm                    │
│ 8. System creates membership, marks invitation accepted        │
│ 9. User redirected to workspace dashboard                      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Invitation Edge Cases

**When inviting an email:**

| Scenario | Behavior |
|----------|----------|
| New email, no pending invite | Create invitation, send email |
| New email, pending invite exists | Error: "Invitation already pending" (offer resend) |
| Existing user, not in workspace | Create invitation, send email (they'll just confirm) |
| Existing user, already in workspace | Error: "User is already a member" |
| Existing user, pending invite exists | Error: "Invitation already pending" (offer resend) |

**When accepting an invitation:**

| Scenario | Behavior |
|----------|----------|
| Token expired | Error: "Invitation expired" (show contact admin) |
| Token revoked | Error: "Invitation no longer valid" |
| Already accepted | Error: "Invitation already used" (redirect to workspace) |
| Email mismatch (logged in as different user) | Error: "This invitation is for a different email" |

### 4.4 Password Reset Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User clicks "Forgot Password" on login page                 │
│ 2. Enters email address                                        │
│ 3. System creates reset token, sends email                     │
│    (Always shows success message, even if email not found)     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. User receives email with reset link                         │
│    Link: /reset-password/{token}                               │
│ 5. User clicks link, enters new password                       │
│ 6. System validates token, updates password hash               │
│ 7. System invalidates all other sessions (optional)            │
│ 8. User redirected to login page                               │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 First User / Migration Flow

For existing single-admin systems migrating to multi-user:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. On first login after upgrade, admin is prompted to          │
│    create a proper user account with password                  │
│ 2. System creates user record, assigns owner role to           │
│    all existing workspaces                                     │
│ 3. ADMIN_EMAIL/ADMIN_PASSWORD env vars become fallback only    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Email Templates

### 5.1 Workspace Invitation

**Subject:** `You've been invited to join {workspace_name} on Staminads`

```html
Hi,

{inviter_name} has invited you to join {workspace_name} as {role} on Staminads.

[Accept Invitation]  (button linking to /invite/{token})

This invitation expires in 7 days.

If you didn't expect this invitation, you can ignore this email.

---
Staminads Analytics
{workspace_website}
```

### 5.2 Password Reset

**Subject:** `Reset your Staminads password`

```html
Hi {user_name},

We received a request to reset your password. Click the button below to choose a new password:

[Reset Password]  (button linking to /reset-password/{token})

This link expires in 1 hour.

If you didn't request this, you can ignore this email. Your password won't be changed.

---
Staminads Analytics
```

### 5.3 Welcome Email (After Accepting Invitation)

**Subject:** `Welcome to {workspace_name} on Staminads`

```html
Hi {user_name},

You've successfully joined {workspace_name} as {role}.

[Go to Dashboard]  (button linking to /workspaces/{workspace_id})

---
Staminads Analytics
```

---

## 6. Security Considerations

### 6.1 Token & API Key Security

**Hashing Strategy:**
- **Passwords**: bcrypt (slow, brute-force resistant)
- **Tokens & API keys**: SHA-256 (fast, tokens already have 256-bit entropy)

**Why SHA-256 for tokens/keys:**
- Tokens have 256 bits of entropy (64 hex chars) - already brute-force resistant
- API keys are checked on every SDK request - can't afford 100-300ms bcrypt
- SHA-256 is ~1µs vs bcrypt's ~100-300ms
- Available in all languages (Go: `crypto/sha256`, Node: `crypto`)

```typescript
import crypto from 'crypto';

// Token/API key generation
const token = crypto.randomBytes(32).toString('hex'); // 64 chars, 256 bits
const hash = crypto.createHash('sha256').update(token).digest('hex');
// Store hash in DB, send token to user

// Token/API key verification (constant-time!)
function verifyToken(token: string, storedHash: string): boolean {
  const computedHash = crypto.createHash('sha256').update(token).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}
```

### 6.2 Password Requirements
- Minimum 8 characters
- bcrypt hashing with cost factor 12
- No password reuse validation (optional future enhancement)

### 6.3 Rate Limiting
- Login: 5 attempts per email per 15 minutes
- Password reset requests: 3 per email per hour
- Invitation sends: 10 per workspace per hour

### 6.4 SMTP Password Storage
- Encrypted using workspace-specific key (same pattern as API keys)
- Never exposed in API responses (masked as `***`)

### 6.5 Session Management
- JWT tokens with configurable expiration (default 7 days)
- User ID included in JWT payload
- Optional: invalidate all sessions on password change

### 6.6 API Key Authentication

```typescript
import crypto from 'crypto';

// Authentication flow for API keys (using prefix lookup + SHA-256)
async function authenticateApiKey(authHeader: string) {
  // 1. Extract key from "Bearer sk_live_..."
  const key = authHeader.replace('Bearer ', '');

  // 2. Compute hash of provided key (fast: ~1µs)
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');

  // 3. Use prefix for efficient lookup (first 15 chars)
  const prefix = key.substring(0, 15);
  const candidate = await clickhouse.query(`
    SELECT * FROM api_keys FINAL
    WHERE key_prefix = {prefix:String}
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `, { prefix });

  // 4. Constant-time comparison (prevents timing attacks)
  if (!candidate) {
    // Perform dummy comparison to prevent timing leak
    crypto.timingSafeEqual(
      Buffer.from(keyHash, 'hex'),
      Buffer.alloc(32) // dummy hash
    );
    throw new UnauthorizedException('Invalid API key');
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(keyHash, 'hex'),
    Buffer.from(candidate.key_hash, 'hex')
  );

  if (!isValid) {
    await incrementFailedAttempts(candidate.id);
    throw new UnauthorizedException('Invalid API key');
  }

  // 5. Update last_used_at
  await updateLastUsed(candidate.id);

  // 6. Load service account and memberships
  const serviceAccount = await getUser(candidate.user_id);
  return { user: serviceAccount, apiKey: candidate };
}

// Scope checking middleware
function requireScope(scope: string) {
  return (req, res, next) => {
    if (!req.apiKey) return next(); // JWT auth, skip scope check
    const scopes = JSON.parse(req.apiKey.scopes);
    if (!scopes.includes(scope)) {
      throw new ForbiddenException(`Missing scope: ${scope}`);
    }
    next();
  };
}
```

### 6.7 ClickHouse Considerations

Since ClickHouse is used for auth data (eventual consistency, no ACID):

**Mitigations:**
1. **Always use FINAL** in queries for users/memberships/invitations
2. **Application-level uniqueness** - Check email exists before insert
3. **Optimistic locking** - Use updated_at for conflict detection
4. **Idempotent operations** - Design for safe retries

```typescript
// Always query with FINAL for auth tables
const user = await clickhouse.query(`
  SELECT * FROM users FINAL
  WHERE email = {email:String}
  LIMIT 1
`);

// Check uniqueness before insert
async function createUser(email: string) {
  const existing = await getUserByEmail(email);
  if (existing) throw new ConflictException('Email already exists');
  // Insert new user...
}
```

**Acceptable because:**
- Low write volume for auth data (not analytics scale)
- ReplacingMergeTree with updated_at ensures latest wins
- Critical operations (login, password reset) are read-heavy

### 6.8 Cascade Delete Policy

**When a user is deleted (soft delete):**

| Entity | Action |
|--------|--------|
| User record | Set `deleted_at`, `deleted_by` (soft delete) |
| Workspace memberships | Remove all memberships |
| Pending invitations sent BY user | Keep (historical record) |
| Pending invitations TO user | Revoke |
| API keys created by user | Keep (service accounts remain) |
| Audit logs | Keep (compliance requirement) |
| **Owned workspaces** | **Block deletion - must transfer ownership first** |

**Owner protection rules:**
- Owners cannot be removed from their workspace by anyone
- Owners cannot remove themselves (must transfer ownership first)
- Only the owner can transfer ownership to another admin
- A workspace must always have exactly one owner

```typescript
async function deleteUser(userId: string, actorId: string) {
  // Check if user owns any workspaces
  const ownedWorkspaces = await getWorkspacesWhereOwner(userId);
  if (ownedWorkspaces.length > 0) {
    throw new BadRequestException(
      'Transfer ownership of all workspaces before deleting account'
    );
  }
  // Proceed with soft delete...
}

async function removeMember(workspaceId: string, targetUserId: string, actorId: string) {
  const targetMembership = await getMembership(workspaceId, targetUserId);

  // Owners cannot be removed
  if (targetMembership.role === 'owner') {
    throw new ForbiddenException('Cannot remove workspace owner');
  }

  // ... rest of removal logic
}
```

**When a workspace is deleted:**

| Entity | Action |
|--------|--------|
| Workspace record | Hard delete |
| Workspace database | Drop database |
| Memberships | Hard delete |
| Pending invitations | Hard delete |
| API keys (workspace-scoped) | Hard delete |
| Audit logs | Keep (compliance) |

---

## 7. Console (Frontend) Changes

### 7.1 New Routes

| Route | Description |
|-------|-------------|
| `/login` | Updated with forgot password link |
| `/register` | Registration form (reached via invitation) |
| `/invite/:token` | Accept invitation page |
| `/reset-password/:token` | Password reset form |
| `/forgot-password` | Request password reset |

### 7.2 Settings Page Additions

**Team Members Section** (`/workspaces/:id/settings?section=team`)
- List of current members with roles
- Invite member button (opens modal)
- Role dropdown for each member
- Remove member button
- Pending invitations list with resend/revoke

**API Keys Section** (`/workspaces/:id/settings?section=api-keys`)
- List of API keys (name, prefix, scopes, last used, created by)
- Create new key button (opens modal)
- Revoke key button with confirmation
- **Important:** Show full key only once after creation with copy button

**SMTP Settings Section** (`/workspaces/:id/settings?section=smtp`) - Owner only
- Enable/disable SMTP
- Host, port, TLS toggle
- Username, password (masked input)
- From name, from email
- Test email button

### 7.3 Profile Dropdown Updates
- Show user name/email
- Link to profile settings
- Logout button

---

## 8. Migration Strategy

### Phase 1: Database Schema
1. Create new tables (users, workspace_memberships, invitations, password_reset_tokens)
2. Add smtp field to workspace settings

### Phase 2: API Updates
1. Update auth.login to check users table first, fall back to env vars
2. Add new auth endpoints (register, forgotPassword, resetPassword)
3. Add invitation endpoints
4. Add member management endpoints
5. Add SMTP endpoints

### Phase 3: Console Updates
1. Update login page with forgot password
2. Add invitation acceptance pages
3. Add team management to settings
4. Add SMTP configuration to settings

### Phase 4: Admin Migration
1. On first login, prompt admin to create user account
2. Assign owner role to all existing workspaces
3. Document that env var auth is deprecated but still works

---

## 9. Files to Create/Modify

### API (New Files)
- `api/src/database/schemas/002_users.sql`
- `api/src/users/users.module.ts`
- `api/src/users/users.service.ts`
- `api/src/users/users.controller.ts`
- `api/src/users/entities/user.entity.ts`
- `api/src/invitations/invitations.module.ts`
- `api/src/invitations/invitations.service.ts`
- `api/src/invitations/invitations.controller.ts`
- `api/src/invitations/entities/invitation.entity.ts`
- `api/src/members/members.module.ts`
- `api/src/members/members.service.ts`
- `api/src/members/members.controller.ts`
- `api/src/api-keys/api-keys.module.ts`
- `api/src/api-keys/api-keys.service.ts`
- `api/src/api-keys/api-keys.controller.ts`
- `api/src/api-keys/entities/api-key.entity.ts`
- `api/src/smtp/smtp.module.ts`
- `api/src/smtp/smtp.service.ts`
- `api/src/smtp/smtp.controller.ts`
- `api/src/mail/mail.module.ts`
- `api/src/mail/mail.service.ts`
- `api/src/mail/templates/` (email templates)
- `api/src/audit/audit.module.ts`
- `api/src/audit/audit.service.ts`

### API (Modified Files)
- `api/src/auth/auth.service.ts` - Multi-user login
- `api/src/auth/auth.controller.ts` - New endpoints
- `api/src/auth/strategies/jwt.strategy.ts` - User lookup
- `api/src/workspaces/entities/workspace.entity.ts` - SMTP settings type

### Console (New Files)
- `console/src/routes/forgot-password.tsx`
- `console/src/routes/reset-password.$token.tsx`
- `console/src/routes/invite.$token.tsx`
- `console/src/routes/register.tsx`
- `console/src/components/settings/TeamSettings.tsx`
- `console/src/components/settings/ApiKeysSettings.tsx`
- `console/src/components/settings/SmtpSettings.tsx`
- `console/src/components/settings/InviteMemberModal.tsx`
- `console/src/components/settings/CreateApiKeyModal.tsx`

### Console (Modified Files)
- `console/src/routes/login.tsx` - Forgot password link
- `console/src/routes/_authenticated/workspaces/$workspaceId/settings.tsx` - New sections
- `console/src/lib/api.ts` - New API methods
- `console/src/types/` - New types

---

## 10. Design Decisions

1. **Email verification**: Not required. Email is implicitly trusted since the user received the invitation at that address.

2. **Workspace creation**: Restricted to the first admin only (the original admin from environment variables). Invited users cannot create new workspaces.

3. **SMTP configuration**: Per-workspace SMTP takes priority. Optional global fallback via environment variables allows invitations without per-workspace config.

4. **Invitation limits**: No hard limit initially. Can be added later if needed.

5. **Audit logging**: Out of scope for initial implementation. Can be added as future enhancement.

---

## 11. Implementation Notes

### Admin Account Persistence

The first admin (from `ADMIN_EMAIL` env var) is special:
- Always has the ability to create workspaces
- On first login after migration, creates a proper user record
- Can be identified by a flag in the users table (`is_super_admin`)
- Other users invited to workspaces cannot create new workspaces

### SMTP Configuration Priority

1. **Per-workspace SMTP** (highest priority): If configured in workspace settings, use it
2. **Global fallback SMTP** (optional): Environment variables provide default SMTP for workspaces without custom config
3. **No SMTP**: "Invite Member" disabled, prompt to configure SMTP

**Global SMTP Environment Variables:**
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_TLS=true
SMTP_USER=username              # Optional
SMTP_PASSWORD=password          # Optional
SMTP_FROM_NAME=Staminads
SMTP_FROM_EMAIL=noreply@example.com
```

UI behavior:
- If global SMTP is configured, invitations work immediately
- Workspace owners can override with custom SMTP
- Settings page shows which SMTP is active (global vs custom)

### Graceful Migration Path

1. Existing systems continue to work with env var admin
2. First login creates user record automatically
3. Existing workspaces get admin as owner
4. No breaking changes to existing deployments
