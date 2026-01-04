# User Invitation System - Implementation Plans

This directory contains detailed implementation plans for each parallel track of the User Invitation System.

## Overview

These plans are designed to be executed in parallel by multiple developers or teams. Each plan is self-contained with:
- File lists and directory structure
- Full code examples
- DTOs, services, controllers, and tests
- Deliverables checklists
- Acceptance criteria

## Plan Index

### Phase 0: Foundation (Sequential)
| Plan | Description |
|------|-------------|
| [00-foundation.md](./00-foundation.md) | Database schema, crypto utilities, shared entities |

### Phase 1: Independent Backend Modules (Parallel)
| Plan | Description | Can Start After |
|------|-------------|-----------------|
| [01-track-a-users.md](./01-track-a-users.md) | Users module with authentication | Phase 0 |
| [02-track-b-smtp-mail.md](./02-track-b-smtp-mail.md) | SMTP settings and email templates | Phase 0 |
| [03-track-c-api-keys.md](./03-track-c-api-keys.md) | API key generation and authentication | Phase 0 |
| [06-track-f-audit.md](./06-track-f-audit.md) | Audit logging service | Phase 0 |

### Phase 2: Dependent Backend Modules (Parallel)
| Plan | Description | Dependencies |
|------|-------------|--------------|
| [04-track-d-invitations.md](./04-track-d-invitations.md) | Invitation sending and acceptance | Users, SMTP/Mail |
| [05-track-e-members.md](./05-track-e-members.md) | Workspace membership management | Users |
| [07-track-g-auth-updates.md](./07-track-g-auth-updates.md) | Multi-user auth, sessions, password reset | Users, Audit |

### Phase 3: Frontend (Parallel with Backend)
| Plan | Description | API Dependencies |
|------|-------------|------------------|
| [08-track-h-frontend-auth.md](./08-track-h-frontend-auth.md) | Login, register, password reset pages | Auth endpoints |
| [09-track-i-frontend-invite.md](./09-track-i-frontend-invite.md) | Invitation acceptance page | Invitations endpoints |
| [10-track-j-frontend-team.md](./10-track-j-frontend-team.md) | Team settings component | Members, Invitations endpoints |
| [11-track-k-frontend-apikeys.md](./11-track-k-frontend-apikeys.md) | API keys settings component | API Keys endpoints |
| [12-track-l-frontend-smtp.md](./12-track-l-frontend-smtp.md) | SMTP settings component | SMTP endpoints |

## Dependency Visualization

```
Phase 0: Foundation
    │
    ├── 00-foundation (Schema + Crypto + Entities)
    │
    ▼
Phase 1: Independent Modules (can run in parallel)
    │
    ├── 01-track-a-users ──────────────┐
    ├── 02-track-b-smtp-mail ──────────┼──┐
    ├── 03-track-c-api-keys            │  │
    └── 06-track-f-audit ──────────────┼──┼──┐
                                       │  │  │
Phase 2: Dependent Modules             │  │  │
    │                                  │  │  │
    ├── 04-track-d-invitations ◄───────┴──┘  │
    ├── 05-track-e-members ◄───────────┘     │
    └── 07-track-g-auth-updates ◄────────────┘

Phase 3: Frontend (can start with API contracts)
    │
    ├── 08-track-h-frontend-auth
    ├── 09-track-i-frontend-invite
    ├── 10-track-j-frontend-team
    ├── 11-track-k-frontend-apikeys
    └── 12-track-l-frontend-smtp
```

## Getting Started

1. **Review the main spec**: [user-invitation-system.md](../user-invitation-system.md)
2. **Review parallelization guide**: [user-invitation-parallelization.md](../user-invitation-parallelization.md)
3. **Pick a track** based on team assignment
4. **Complete Phase 0 first** (required by all tracks)
5. **Work through your assigned track(s)** using the checklist

## Sync Points

| Checkpoint | Criteria |
|------------|----------|
| After Phase 0 | All tables created, crypto utils tested, entities exported |
| After Phase 1 | Core modules have unit tests passing |
| After Phase 2 | Integration tests for invitation + member flows |
| Final | Full E2E tests, frontend integrated |

## Notes

- Each plan includes complete, runnable code examples
- DTOs include validation decorators
- Services include error handling
- Controllers include OpenAPI annotations
- Unit test examples use Jest + NestJS testing utilities
- Frontend uses React + TanStack Query + Ant Design patterns
