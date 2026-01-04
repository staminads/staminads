# User Invitation System - Parallelization Guide

This guide describes how to parallelize the implementation of the [User Invitation System](./user-invitation-system.md) across multiple developers or teams.

---

## Overview

The user invitation system consists of multiple independent modules that can be developed concurrently. By defining interfaces upfront and identifying dependencies, teams can work in parallel with minimal coordination overhead.

**Benefits of parallelization:**
- Faster overall delivery
- Reduced merge conflicts (isolated modules)
- Clearer ownership and accountability
- Earlier testing of individual components

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PHASE 0: FOUNDATION                             │
│                         (Sequential - 1 team)                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Database Schema (002_users.sql)                                 │   │
│  │  Crypto Utilities (token generation, hashing)                    │   │
│  │  Shared Interfaces (User, Invitation, Membership, ApiKey, etc.)  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│   TRACK A     │           │   TRACK B     │           │   TRACK C     │
│   Users       │           │   SMTP/Mail   │           │   API Keys    │
│   Module      │           │   Module      │           │   Module      │
└───────┬───────┘           └───────┬───────┘           └───────────────┘
        │                           │
        │               ┌───────────┘
        │               │
        ▼               ▼
┌───────────────────────────┐   ┌───────────────┐   ┌───────────────┐
│       TRACK D             │   │   TRACK E     │   │   TRACK F     │
│       Invitations         │   │   Members     │   │   Audit       │
│       (needs Users+Mail)  │   │   Module      │   │   Module      │
└───────────────────────────┘   └───────────────┘   └───────────────┘
        │                               │                   │
        └───────────────┬───────────────┘                   │
                        │                                   │
                        ▼                                   │
                ┌───────────────┐                           │
                │   TRACK G     │                           │
                │   Auth        │◄──────────────────────────┘
                │   Updates     │
                └───────────────┘
```

---

## Phase Breakdown

### Phase 0: Foundation (Sequential)

Must be completed before parallel work begins. Assign to 1-2 developers.

#### Database Schema
**File:** `api/src/database/schemas/002_users.sql`

All 7 tables:
- `users`
- `sessions`
- `workspace_memberships`
- `invitations`
- `password_reset_tokens`
- `audit_logs`
- `api_keys`

#### Crypto Utilities
**File:** `api/src/common/crypto.ts`

```typescript
// Token generation (SHA-256 hashing for tokens/API keys)
export function generateToken(): { token: string; hash: string };

// Password hashing (bcrypt)
export function hashPassword(password: string): Promise<string>;
export function verifyPassword(password: string, hash: string): Promise<boolean>;

// Constant-time comparison
export function verifyTokenHash(token: string, storedHash: string): boolean;
```

#### Shared Entities/Interfaces
**Directory:** `api/src/common/entities/`

- `user.entity.ts` - User, UserStatus, UserType
- `membership.entity.ts` - WorkspaceMembership, Role
- `invitation.entity.ts` - Invitation, InvitationStatus
- `api-key.entity.ts` - ApiKey, ApiScope
- `audit-log.entity.ts` - AuditLog, AuditAction

#### Deliverables Checklist
- [ ] All 7 database tables created
- [ ] Crypto utility functions with tests
- [ ] All entity interfaces defined
- [ ] Permission constants defined (`PERMISSIONS`, `ROLE_HIERARCHY`)

---

### Phase 1: Independent Backend Modules (Parallel)

These modules have no dependencies on each other and can be developed simultaneously.

---

#### Track A: Users Module

**Dependencies:** Phase 0 only

**Files to create:**
```
api/src/users/
├── users.module.ts
├── users.service.ts
├── users.controller.ts
├── dto/
│   ├── create-user.dto.ts
│   ├── update-user.dto.ts
│   └── change-password.dto.ts
└── entities/
    └── user.entity.ts (import from common)
```

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `auth.register` | POST | Create new user (from invitation) |
| `auth.me` | GET | Get current user profile |
| `auth.updateProfile` | POST | Update name, email |
| `auth.changePassword` | POST | Change password |

**Key implementation notes:**
- Password hashing with bcrypt (cost factor 12)
- Email uniqueness check before insert
- Use `FINAL` in all ClickHouse queries
- Rate limiting for login attempts (5 per 15 min)

**Deliverables Checklist:**
- [ ] UsersModule with DI setup
- [ ] UsersService with CRUD operations
- [ ] UsersController with endpoints
- [ ] DTOs with class-validator
- [ ] Unit tests for service
- [ ] Integration tests for controller

---

#### Track B: SMTP/Mail Module

**Dependencies:** Phase 0 only

**Files to create:**
```
api/src/smtp/
├── smtp.module.ts
├── smtp.service.ts
├── smtp.controller.ts
└── dto/
    ├── smtp-settings.dto.ts
    └── test-smtp.dto.ts

api/src/mail/
├── mail.module.ts
├── mail.service.ts
└── templates/
    ├── invitation.html
    ├── password-reset.html
    └── welcome.html
```

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `smtp.status` | GET | Check SMTP availability |
| `smtp.get` | GET | Get SMTP settings (owner only) |
| `smtp.update` | POST | Update SMTP settings |
| `smtp.delete` | POST | Remove workspace SMTP |
| `smtp.test` | POST | Send test email |

**Key implementation notes:**
- Support workspace-level and global (env) SMTP configs
- Encrypt SMTP passwords before storing
- Email templates with variable substitution
- Use nodemailer for sending

**Deliverables Checklist:**
- [ ] SmtpModule with configuration
- [ ] SmtpService for workspace settings management
- [ ] SmtpController with endpoints
- [ ] MailModule for email sending
- [ ] MailService with template rendering
- [ ] 3 email templates (invitation, password-reset, welcome)
- [ ] Unit tests
- [ ] Test email functionality

---

#### Track C: API Keys Module

**Dependencies:** Phase 0 only

**Files to create:**
```
api/src/api-keys/
├── api-keys.module.ts
├── api-keys.service.ts
├── api-keys.controller.ts
├── guards/
│   └── api-key.guard.ts
├── decorators/
│   └── require-scope.decorator.ts
├── dto/
│   ├── create-api-key.dto.ts
│   └── update-api-key.dto.ts
└── entities/
    └── api-key.entity.ts
```

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `apiKeys.list` | GET | List workspace API keys |
| `apiKeys.create` | POST | Create new key (returns key once) |
| `apiKeys.get` | GET | Get key details (not the key itself) |
| `apiKeys.update` | POST | Update name, description, scopes |
| `apiKeys.revoke` | POST | Revoke an API key |
| `apiKeys.rotate` | POST | Revoke old + create new |

**Key implementation notes:**
- Key format: `sk_live_` + 32 random hex bytes
- Store SHA-256 hash, never plaintext
- Use prefix for efficient DB lookup
- Constant-time comparison to prevent timing attacks
- Service account user type for API key ownership

**Deliverables Checklist:**
- [ ] ApiKeysModule setup
- [ ] ApiKeysService with key generation/validation
- [ ] ApiKeysController with endpoints
- [ ] ApiKeyGuard for authenticating requests
- [ ] RequireScope decorator for permission checking
- [ ] Unit tests
- [ ] Authentication flow tests

---

#### Track F: Audit Module

**Dependencies:** Phase 0 only

**Files to create:**
```
api/src/audit/
├── audit.module.ts
├── audit.service.ts
└── entities/
    └── audit-log.entity.ts
```

**No API endpoints** - internal service only.

**Key implementation notes:**
- Fire-and-forget logging (don't block main operations)
- Include actor ID, workspace ID, target entity, metadata
- 90-day TTL in ClickHouse
- Support all action types from spec

**Action types:**
- `invitation.sent`, `invitation.accepted`, `invitation.revoked`, `invitation.expired`
- `member.added`, `member.role_changed`, `member.removed`, `member.left`
- `password.reset_requested`, `password.changed`
- `api_key.created`, `api_key.revoked`

**Deliverables Checklist:**
- [ ] AuditModule setup
- [ ] AuditService.log() method
- [ ] All action type constants
- [ ] Unit tests
- [ ] Async/non-blocking implementation

---

### Phase 2: Dependent Backend Modules (Parallel)

These modules depend on Phase 1 modules but can be developed in parallel with each other.

---

#### Track D: Invitations Module

**Dependencies:** Users Module (Track A), Mail Module (Track B)

**Files to create:**
```
api/src/invitations/
├── invitations.module.ts
├── invitations.service.ts
├── invitations.controller.ts
├── dto/
│   ├── create-invitation.dto.ts
│   └── accept-invitation.dto.ts
└── entities/
    └── invitation.entity.ts
```

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `invitations.list` | GET | List workspace invitations |
| `invitations.create` | POST | Send invitation email |
| `invitations.resend` | POST | Resend invitation email |
| `invitations.revoke` | POST | Revoke pending invitation |
| `invitations.get` | GET | Get invitation by token (public) |
| `invitations.accept` | POST | Accept invitation (public) |

**Key implementation notes:**
- 7-day token expiration
- Handle new user vs existing user flows
- Email validation against invitation email
- Rate limiting (10 invitations per workspace per hour)

**Deliverables Checklist:**
- [ ] InvitationsModule setup
- [ ] InvitationsService with all flows
- [ ] InvitationsController with endpoints
- [ ] Token generation and validation
- [ ] Email sending integration
- [ ] Edge case handling (already member, expired, etc.)
- [ ] Unit and integration tests

---

#### Track E: Members Module

**Dependencies:** Users Module (Track A)

**Files to create:**
```
api/src/members/
├── members.module.ts
├── members.service.ts
├── members.controller.ts
├── guards/
│   └── workspace-role.guard.ts
├── decorators/
│   └── require-permission.decorator.ts
└── dto/
    ├── update-role.dto.ts
    └── transfer-ownership.dto.ts
```

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `members.list` | GET | List workspace members |
| `members.updateRole` | POST | Change member role |
| `members.remove` | POST | Remove member |
| `members.leave` | POST | Leave workspace (self) |
| `members.transferOwnership` | POST | Transfer ownership |

**Key implementation notes:**
- Role hierarchy enforcement (admin can't remove admin)
- Owner protection (can't be removed)
- Single owner per workspace constraint
- Permission checking via `canRemoveMember()` logic

**Deliverables Checklist:**
- [ ] MembersModule setup
- [ ] MembersService with role management
- [ ] MembersController with endpoints
- [ ] WorkspaceRoleGuard for permission checking
- [ ] RequirePermission decorator
- [ ] Ownership transfer logic
- [ ] Unit and integration tests

---

#### Track G: Auth Updates

**Dependencies:** Users Module (Track A), Audit Module (Track F)

**Files to modify:**
```
api/src/auth/
├── auth.module.ts (update imports)
├── auth.service.ts (multi-user support)
├── auth.controller.ts (new endpoints)
├── strategies/jwt.strategy.ts (user lookup)
└── dto/
    ├── forgot-password.dto.ts (new)
    └── reset-password.dto.ts (new)
```

**New/Updated Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `auth.login` | POST | Update for multi-user |
| `auth.forgotPassword` | POST | Request password reset |
| `auth.resetPassword` | POST | Reset with token |
| `auth.sessions` | GET | List active sessions |
| `auth.revokeSession` | POST | Revoke specific session |
| `auth.revokeAllSessions` | POST | Logout all devices |

**Key implementation notes:**
- Keep env var fallback for backward compatibility
- Password reset with 1-hour token expiration
- Session tracking in ClickHouse
- Rate limiting (3 reset requests per hour)

**Deliverables Checklist:**
- [ ] Multi-user login support
- [ ] JWT payload update to include user ID
- [ ] Password reset flow
- [ ] Session management
- [ ] Backward compatible env var auth
- [ ] Migration flow for first admin
- [ ] Unit and integration tests

---

### Phase 3: Frontend (Can Start with Phase 1)

Frontend tracks can begin once API contracts are defined (after Phase 0). Implementation proceeds against mock data or stubs until backend is ready.

---

#### Track H: Auth Pages

**Dependencies:** API contracts for auth endpoints

**Files to create:**
```
console/src/routes/
├── forgot-password.tsx
├── reset-password.$token.tsx
└── register.tsx
```

**Files to modify:**
```
console/src/routes/login.tsx (add forgot password link)
console/src/lib/auth.tsx (update for user profile)
console/src/lib/api.ts (add auth methods)
```

**Deliverables Checklist:**
- [ ] Login page with "Forgot password?" link
- [ ] Forgot password page
- [ ] Reset password page with token handling
- [ ] Registration page (from invitation)
- [ ] API client methods
- [ ] Form validation
- [ ] Error handling

---

#### Track I: Invitation Acceptance Page

**Dependencies:** API contracts for invitations endpoints

**Files to create:**
```
console/src/routes/invite.$token.tsx
```

**Deliverables Checklist:**
- [ ] Token validation on load
- [ ] Workspace info display
- [ ] New user registration form
- [ ] Existing user confirmation
- [ ] Error states (expired, invalid, already member)
- [ ] Success redirect

---

#### Track J: Team Settings

**Dependencies:** API contracts for members endpoints

**Files to create:**
```
console/src/components/settings/TeamSettings.tsx
console/src/components/settings/InviteMemberModal.tsx
```

**Files to modify:**
```
console/src/routes/_authenticated/workspaces/$workspaceId/settings.tsx
console/src/lib/api.ts (add members/invitations methods)
```

**Deliverables Checklist:**
- [ ] Member list with roles
- [ ] Role change dropdown
- [ ] Remove member button with confirmation
- [ ] Pending invitations list
- [ ] Invite member modal
- [ ] Resend/revoke invitation actions
- [ ] Permission-based UI (hide actions for non-admins)

---

#### Track K: API Keys Settings

**Dependencies:** API contracts for apiKeys endpoints

**Files to create:**
```
console/src/components/settings/ApiKeysSettings.tsx
console/src/components/settings/CreateApiKeyModal.tsx
```

**Deliverables Checklist:**
- [ ] API key list (name, prefix, scopes, last used)
- [ ] Create key modal with scope selection
- [ ] Show full key only once (with copy button)
- [ ] Revoke confirmation dialog
- [ ] Empty state

---

#### Track L: SMTP Settings

**Dependencies:** API contracts for smtp endpoints

**Files to create:**
```
console/src/components/settings/SmtpSettings.tsx
```

**Deliverables Checklist:**
- [ ] SMTP config form (host, port, TLS, credentials)
- [ ] From name/email fields
- [ ] Test email button
- [ ] Status indicator (workspace vs global)
- [ ] Owner-only visibility

---

## Sync Points

### After Phase 0 Completion
- All teams review shared interfaces
- Agree on API contracts (request/response shapes)
- Set up feature branches

### After Phase 1 Completion
- Integration test core modules together
- Verify database operations
- Demo to stakeholders

### After Phase 2 Completion
- Full system integration testing
- End-to-end flow testing
- Performance testing

### Final Integration
- Frontend + backend integration
- Full user flow testing
- Security review

---

## Team Assignment Recommendations

### 4-Developer Team

| Developer | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|-----------|---------|---------|---------|---------|
| Dev 1 | Schema + Crypto | Users (A) | Auth Updates (G) | - |
| Dev 2 | Entities | SMTP/Mail (B) | Invitations (D) | - |
| Dev 3 | - | API Keys (C) | Members (E) | - |
| Dev 4 | - | Audit (F) | - | All Frontend |

### 6-Developer Team

| Developer | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|-----------|---------|---------|---------|---------|
| Dev 1 | Schema + Crypto | Users (A) | Auth Updates (G) | - |
| Dev 2 | Entities | SMTP/Mail (B) | Invitations (D) | - |
| Dev 3 | - | API Keys (C) | - | API Keys UI (K) |
| Dev 4 | - | Audit (F) | Members (E) | - |
| Dev 5 | - | - | - | Auth Pages (H) + Invite (I) |
| Dev 6 | - | - | - | Team Settings (J) + SMTP (L) |

---

## Critical Path

The minimum path to a working invitation system:

1. **Schema** (Phase 0)
2. **Users Module** (Phase 1, Track A)
3. **SMTP/Mail Module** (Phase 1, Track B)
4. **Invitations Module** (Phase 2, Track D)
5. **Members Module** (Phase 2, Track E)
6. **Auth Updates** (Phase 2, Track G)
7. **Frontend: Auth + Invite + Team Settings** (Phase 3)

API Keys, Audit Logging, and SMTP Settings UI can be added after core functionality is complete.

---

## Notes

- All backend modules should export their services for other modules to use
- Use feature flags if deploying incrementally
- Write integration tests at module boundaries
- Frontend can use MSW (Mock Service Worker) to develop against API contracts before backend is ready
