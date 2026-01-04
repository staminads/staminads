# Track F: Audit Module Implementation Plan

**Track:** F - Audit Module
**Dependencies:** Phase 0 (Foundation)
**Blocks:** None (infrastructure service)

---

## Overview

The Audit module provides fire-and-forget logging for security and compliance events. It tracks user actions related to invitations, memberships, passwords, and API keys.

---

## Files to Create

```
api/src/audit/
├── audit.module.ts
├── audit.service.ts
└── audit.service.spec.ts
```

---

## Task 1: Audit Service

**File:** `api/src/audit/audit.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { generateId } from '../common/crypto';
import { AuditLog, AuditAction, AUDIT_ACTIONS } from '../common/entities';

export interface AuditLogParams {
  userId: string;
  workspaceId?: string;
  action: AuditAction;
  targetType: 'user' | 'invitation' | 'membership' | 'api_key';
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly clickhouse: ClickHouseService) {}

  /**
   * Log an audit event (fire-and-forget, non-blocking)
   */
  log(params: AuditLogParams): void {
    // Don't await - fire and forget
    this.writeLog(params).catch((error) => {
      this.logger.error(`Failed to write audit log: ${error.message}`, error.stack);
    });
  }

  /**
   * Log an audit event and wait for completion
   */
  async logSync(params: AuditLogParams): Promise<void> {
    await this.writeLog(params);
  }

  /**
   * Query audit logs for a workspace
   */
  async query(options: {
    workspaceId?: string;
    userId?: string;
    action?: AuditAction;
    targetType?: string;
    targetId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLog[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.workspaceId) {
      conditions.push('workspace_id = {workspaceId:String}');
      params.workspaceId = options.workspaceId;
    }

    if (options.userId) {
      conditions.push('user_id = {userId:String}');
      params.userId = options.userId;
    }

    if (options.action) {
      conditions.push('action = {action:String}');
      params.action = options.action;
    }

    if (options.targetType) {
      conditions.push('target_type = {targetType:String}');
      params.targetType = options.targetType;
    }

    if (options.targetId) {
      conditions.push('target_id = {targetId:String}');
      params.targetId = options.targetId;
    }

    if (options.startDate) {
      conditions.push('created_at >= {startDate:DateTime64(3)}');
      params.startDate = options.startDate.toISOString();
    }

    if (options.endDate) {
      conditions.push('created_at <= {endDate:DateTime64(3)}');
      params.endDate = options.endDate.toISOString();
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const result = await this.clickhouse.querySystem<AuditLog>(`
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `, params);

    return result.map((log) => ({
      ...log,
      metadata: typeof log.metadata === 'string'
        ? JSON.parse(log.metadata)
        : log.metadata,
    }));
  }

  /**
   * Get audit log count for a workspace
   */
  async count(workspaceId: string): Promise<number> {
    const result = await this.clickhouse.querySystem<{ count: number }>(`
      SELECT count() as count FROM audit_logs
      WHERE workspace_id = {workspaceId:String}
    `, { workspaceId });

    return result[0]?.count || 0;
  }

  private async writeLog(params: AuditLogParams): Promise<void> {
    const log: AuditLog = {
      id: generateId(),
      user_id: params.userId,
      workspace_id: params.workspaceId || null,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      metadata: params.metadata || {},
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      created_at: new Date().toISOString(),
    };

    await this.clickhouse.insertSystem('audit_logs', [{
      ...log,
      metadata: JSON.stringify(log.metadata),
    }]);
  }

  // Convenience methods for common audit events

  /**
   * Log invitation sent
   */
  logInvitationSent(
    userId: string,
    workspaceId: string,
    invitationId: string,
    email: string,
    role: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'invitation.sent',
      targetType: 'invitation',
      targetId: invitationId,
      metadata: { email, role },
      ipAddress,
    });
  }

  /**
   * Log invitation accepted
   */
  logInvitationAccepted(
    userId: string,
    workspaceId: string,
    invitationId: string,
    email: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'invitation.accepted',
      targetType: 'invitation',
      targetId: invitationId,
      metadata: { email },
      ipAddress,
    });
  }

  /**
   * Log invitation revoked
   */
  logInvitationRevoked(
    userId: string,
    workspaceId: string,
    invitationId: string,
    email: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: invitationId,
      metadata: { email },
      ipAddress,
    });
  }

  /**
   * Log member added
   */
  logMemberAdded(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    role: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'member.added',
      targetType: 'membership',
      targetId: memberUserId,
      metadata: { role },
      ipAddress,
    });
  }

  /**
   * Log member role changed
   */
  logMemberRoleChanged(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    oldRole: string,
    newRole: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'member.role_changed',
      targetType: 'membership',
      targetId: memberUserId,
      metadata: { oldRole, newRole },
      ipAddress,
    });
  }

  /**
   * Log member removed
   */
  logMemberRemoved(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'member.removed',
      targetType: 'membership',
      targetId: memberUserId,
      ipAddress,
    });
  }

  /**
   * Log member left
   */
  logMemberLeft(
    userId: string,
    workspaceId: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'member.left',
      targetType: 'membership',
      targetId: userId,
      ipAddress,
    });
  }

  /**
   * Log password reset requested
   */
  logPasswordResetRequested(
    userId: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      action: 'password.reset_requested',
      targetType: 'user',
      targetId: userId,
      ipAddress,
    });
  }

  /**
   * Log password changed
   */
  logPasswordChanged(
    userId: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      action: 'password.changed',
      targetType: 'user',
      targetId: userId,
      ipAddress,
    });
  }

  /**
   * Log API key created
   */
  logApiKeyCreated(
    userId: string,
    workspaceId: string,
    apiKeyId: string,
    name: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: apiKeyId,
      metadata: { name },
      ipAddress,
    });
  }

  /**
   * Log API key revoked
   */
  logApiKeyRevoked(
    userId: string,
    workspaceId: string,
    apiKeyId: string,
    name: string,
    ipAddress?: string,
  ): void {
    this.log({
      userId,
      workspaceId,
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: apiKeyId,
      metadata: { name },
      ipAddress,
    });
  }
}
```

---

## Task 2: Audit Module

**File:** `api/src/audit/audit.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

---

## Task 3: Unit Tests

**File:** `api/src/audit/audit.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { ClickHouseService } from '../database/clickhouse.service';

describe('AuditService', () => {
  let service: AuditService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  beforeEach(async () => {
    const mockClickhouse = {
      querySystem: jest.fn(),
      insertSystem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: ClickHouseService, useValue: mockClickhouse },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    clickhouse = module.get(ClickHouseService);
  });

  describe('log', () => {
    it('should insert audit log asynchronously', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      service.log({
        userId: 'user-1',
        workspaceId: 'ws-1',
        action: 'invitation.sent',
        targetType: 'invitation',
        targetId: 'inv-1',
        metadata: { email: 'test@example.com' },
      });

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'audit_logs',
        expect.arrayContaining([
          expect.objectContaining({
            user_id: 'user-1',
            workspace_id: 'ws-1',
            action: 'invitation.sent',
            target_type: 'invitation',
            target_id: 'inv-1',
          }),
        ]),
      );
    });

    it('should not throw on insert failure', async () => {
      clickhouse.insertSystem.mockRejectedValue(new Error('DB error'));

      expect(() =>
        service.log({
          userId: 'user-1',
          action: 'password.changed',
          targetType: 'user',
          targetId: 'user-1',
        }),
      ).not.toThrow();
    });
  });

  describe('logSync', () => {
    it('should insert audit log synchronously', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.logSync({
        userId: 'user-1',
        action: 'password.changed',
        targetType: 'user',
        targetId: 'user-1',
      });

      expect(clickhouse.insertSystem).toHaveBeenCalled();
    });

    it('should throw on insert failure', async () => {
      clickhouse.insertSystem.mockRejectedValue(new Error('DB error'));

      await expect(
        service.logSync({
          userId: 'user-1',
          action: 'password.changed',
          targetType: 'user',
          targetId: 'user-1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('query', () => {
    it('should query audit logs with filters', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          user_id: 'user-1',
          workspace_id: 'ws-1',
          action: 'invitation.sent',
          target_type: 'invitation',
          target_id: 'inv-1',
          metadata: '{"email":"test@example.com"}',
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ];
      clickhouse.querySystem.mockResolvedValue(mockLogs);

      const result = await service.query({
        workspaceId: 'ws-1',
        action: 'invitation.sent',
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({ email: 'test@example.com' });
    });

    it('should apply date filters', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.query({
        workspaceId: 'ws-1',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('created_at >='),
        expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String),
        }),
      );
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      clickhouse.insertSystem.mockResolvedValue(undefined);
    });

    it('should log invitation sent', async () => {
      service.logInvitationSent(
        'user-1',
        'ws-1',
        'inv-1',
        'test@example.com',
        'editor',
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'audit_logs',
        expect.arrayContaining([
          expect.objectContaining({
            action: 'invitation.sent',
            metadata: expect.stringContaining('test@example.com'),
          }),
        ]),
      );
    });

    it('should log member role changed', async () => {
      service.logMemberRoleChanged(
        'admin-1',
        'ws-1',
        'user-1',
        'viewer',
        'editor',
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'audit_logs',
        expect.arrayContaining([
          expect.objectContaining({
            action: 'member.role_changed',
            metadata: expect.stringContaining('viewer'),
          }),
        ]),
      );
    });

    it('should log API key created', async () => {
      service.logApiKeyCreated('user-1', 'ws-1', 'key-1', 'Production SDK');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'audit_logs',
        expect.arrayContaining([
          expect.objectContaining({
            action: 'api_key.created',
            target_type: 'api_key',
          }),
        ]),
      );
    });
  });
});
```

---

## Task 4: Integration with Other Modules

After the Audit module is complete, integrate it with other modules:

### 4.1 Invitations Service Integration

```typescript
// In invitations.service.ts constructor:
constructor(
  private readonly auditService: AuditService,
  // ... other deps
) {}

// After creating invitation:
this.auditService.logInvitationSent(
  invitedBy,
  dto.workspaceId,
  invitation.id,
  email,
  dto.role,
);

// After accepting:
this.auditService.logInvitationAccepted(
  userId,
  invitation.workspace_id,
  invitation.id,
  invitation.email,
);

// After revoking:
this.auditService.logInvitationRevoked(
  revokedBy,
  invitation.workspace_id,
  invitation.id,
  invitation.email,
);
```

### 4.2 Members Service Integration

```typescript
// After role change:
this.auditService.logMemberRoleChanged(
  actorId,
  dto.workspaceId,
  dto.userId,
  oldRole,
  dto.role,
);

// After removal:
this.auditService.logMemberRemoved(actorId, workspaceId, userId);

// After leaving:
this.auditService.logMemberLeft(userId, workspaceId);
```

### 4.3 API Keys Service Integration

```typescript
// After creating:
this.auditService.logApiKeyCreated(
  createdBy,
  dto.workspaceId,
  id,
  dto.name,
);

// After revoking:
this.auditService.logApiKeyRevoked(
  revokedBy,
  apiKey.workspace_id!,
  id,
  apiKey.name,
);
```

### 4.4 Auth Service Integration

```typescript
// After password reset request:
this.auditService.logPasswordResetRequested(user.id);

// After password change:
this.auditService.logPasswordChanged(userId);
```

---

## Deliverables Checklist

- [ ] `api/src/audit/audit.module.ts`
- [ ] `api/src/audit/audit.service.ts`
- [ ] `api/src/audit/audit.service.spec.ts`
- [ ] Module registered in `app.module.ts`
- [ ] All tests passing
- [ ] Integration instructions documented

---

## Acceptance Criteria

1. Audit logs are written asynchronously (fire-and-forget)
2. Log failures don't crash the application
3. All audit actions from spec are supported
4. Metadata is stored as JSON
5. Query supports filtering by workspace, user, action, dates
6. 90-day TTL is configured in schema
7. Convenience methods cover all common events
8. IP address and user agent can be captured
9. Unit tests have >80% coverage

---

## Notes

- **No API endpoints**: Audit logs are internal only for this phase
- **Future enhancement**: Admin API to query audit logs
- **Compliance**: Logs are kept for 90 days (configurable via schema TTL)
- **Performance**: Fire-and-forget pattern ensures audit logging doesn't slow down operations
