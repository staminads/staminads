import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { AuditLog } from '../common/entities/audit-log.entity';
import { LogAuditDto } from './dto/log-audit.dto';
import { ListAuditDto } from './dto/list-audit.dto';
import { GetAuditByTargetDto } from './dto/get-audit-by-target.dto';

describe('AuditService', () => {
  let service: AuditService;
  let clickhouse: jest.Mocked<ClickHouseService>;

  const mockAuditLog: AuditLog = {
    id: 'audit-123',
    user_id: 'user-456',
    workspace_id: 'ws-test-001',
    action: 'member.added',
    target_type: 'membership',
    target_id: 'member-789',
    metadata: { role: 'admin', email: 'user@example.com' },
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    created_at: '2025-01-01 12:00:00',
  };

  // ClickHouse stores metadata as JSON string
  const mockAuditLogRow = {
    ...mockAuditLog,
    metadata: JSON.stringify(mockAuditLog.metadata),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    clickhouse = module.get(ClickHouseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('creates audit log entry with all required fields', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        workspace_id: 'ws-test-001',
        action: 'member.added',
        target_type: 'membership',
        target_id: 'member-789',
        metadata: { role: 'admin' },
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      };

      const result = await service.log(dto);

      expect(result).toMatchObject({
        user_id: 'user-456',
        workspace_id: 'ws-test-001',
        action: 'member.added',
        target_type: 'membership',
        target_id: 'member-789',
        metadata: { role: 'admin' },
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      });
      expect(result.id).toBeDefined();
      expect(result.created_at).toBeDefined();
    });

    it('generates UUID for id field', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        action: 'password.changed',
        target_type: 'user',
        target_id: 'user-456',
      };

      const result = await service.log(dto);

      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('generates timestamp for created_at field', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        action: 'password.changed',
        target_type: 'user',
        target_id: 'user-456',
      };

      const result = await service.log(dto);

      expect(result.created_at).toBeDefined();
      expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it('handles optional workspace_id when not provided', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        action: 'password.changed',
        target_type: 'user',
        target_id: 'user-456',
      };

      const result = await service.log(dto);

      expect(result.workspace_id).toBeNull();
    });

    it('handles optional metadata when not provided', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        action: 'password.changed',
        target_type: 'user',
        target_id: 'user-456',
      };

      const result = await service.log(dto);

      expect(result.metadata).toEqual({});
    });

    it('handles optional ip_address when not provided', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        action: 'password.changed',
        target_type: 'user',
        target_id: 'user-456',
      };

      const result = await service.log(dto);

      expect(result.ip_address).toBeNull();
    });

    it('handles optional user_agent when not provided', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        action: 'password.changed',
        target_type: 'user',
        target_id: 'user-456',
      };

      const result = await service.log(dto);

      expect(result.user_agent).toBeNull();
    });

    it('inserts audit log into ClickHouse with serialized metadata', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const dto: LogAuditDto = {
        user_id: 'user-456',
        workspace_id: 'ws-test-001',
        action: 'member.added',
        target_type: 'membership',
        target_id: 'member-789',
        metadata: { role: 'admin', permissions: ['read', 'write'] },
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      };

      await service.log(dto);

      expect(clickhouse.insertSystem).toHaveBeenCalledWith('audit_logs', [
        expect.objectContaining({
          user_id: 'user-456',
          workspace_id: 'ws-test-001',
          action: 'member.added',
          target_type: 'membership',
          target_id: 'member-789',
          metadata: JSON.stringify({
            role: 'admin',
            permissions: ['read', 'write'],
          }),
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
        }),
      ]);
    });

    it('supports different audit actions', async () => {
      clickhouse.insertSystem.mockResolvedValue(undefined);

      const actions: Array<{
        action: LogAuditDto['action'];
        target_type: LogAuditDto['target_type'];
      }> = [
        { action: 'invitation.sent', target_type: 'invitation' },
        { action: 'invitation.accepted', target_type: 'invitation' },
        { action: 'member.role_changed', target_type: 'membership' },
        { action: 'ownership.transferred', target_type: 'workspace' },
        { action: 'api_key.created', target_type: 'api_key' },
      ];

      for (const { action, target_type } of actions) {
        const dto: LogAuditDto = {
          user_id: 'user-456',
          action,
          target_type,
          target_id: 'target-123',
        };

        const result = await service.log(dto);

        expect(result.action).toBe(action);
        expect(result.target_type).toBe(target_type);
      }
    });
  });

  describe('list', () => {
    it('returns audit logs without filters', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      const result = await service.list(dto);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'audit-123',
        user_id: 'user-456',
        workspace_id: 'ws-test-001',
        action: 'member.added',
        target_type: 'membership',
      });
    });

    it('parses metadata JSON correctly', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      const result = await service.list(dto);

      expect(result[0].metadata).toEqual({
        role: 'admin',
        email: 'user@example.com',
      });
    });

    it('handles empty metadata', async () => {
      const rowWithEmptyMetadata = {
        ...mockAuditLogRow,
        metadata: '',
      };
      clickhouse.querySystem.mockResolvedValue([rowWithEmptyMetadata]);

      const dto = new ListAuditDto();
      const result = await service.list(dto);

      expect(result[0].metadata).toEqual({});
    });

    it('filters by workspace_id', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.workspace_id = 'ws-test-001';

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE workspace_id = {workspace_id:String}'),
        expect.objectContaining({ workspace_id: 'ws-test-001' }),
      );
    });

    it('filters by user_id', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.user_id = 'user-456';

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = {user_id:String}'),
        expect.objectContaining({ user_id: 'user-456' }),
      );
    });

    it('filters by action', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.action = 'member.added';

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE action = {action:String}'),
        expect.objectContaining({ action: 'member.added' }),
      );
    });

    it('filters by target_type', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.target_type = 'membership';

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE target_type = {target_type:String}'),
        expect.objectContaining({ target_type: 'membership' }),
      );
    });

    it('combines multiple filters with AND', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.workspace_id = 'ws-test-001';
      dto.user_id = 'user-456';
      dto.action = 'member.added';

      await service.list(dto);

      const call = clickhouse.querySystem.mock.calls[0];
      const sql = call[0] as string;

      expect(sql).toContain('WHERE');
      expect(sql).toContain('workspace_id = {workspace_id:String}');
      expect(sql).toContain('AND');
      expect(sql).toContain('user_id = {user_id:String}');
      expect(sql).toContain('action = {action:String}');
    });

    it('uses default limit of 100', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('uses default offset of 0', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ offset: 0 }),
      );
    });

    it('uses custom limit when provided', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.limit = 50;

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('uses custom offset when provided', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      dto.offset = 100;

      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ offset: 100 }),
      );
    });

    it('orders results by created_at DESC', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new ListAuditDto();
      await service.list(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Object),
      );
    });

    it('returns empty array when no logs match', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const dto = new ListAuditDto();
      const result = await service.list(dto);

      expect(result).toEqual([]);
    });

    it('returns multiple audit logs', async () => {
      const mockLog1 = {
        ...mockAuditLogRow,
        id: 'audit-1',
        action: 'member.added',
      };
      const mockLog2 = {
        ...mockAuditLogRow,
        id: 'audit-2',
        action: 'member.removed',
      };
      const mockLog3 = {
        ...mockAuditLogRow,
        id: 'audit-3',
        action: 'api_key.created',
      };

      clickhouse.querySystem.mockResolvedValue([mockLog1, mockLog2, mockLog3]);

      const dto = new ListAuditDto();
      const result = await service.list(dto);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('audit-1');
      expect(result[1].id).toBe('audit-2');
      expect(result[2].id).toBe('audit-3');
    });
  });

  describe('getByTarget', () => {
    it('returns logs for specific target', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      const result = await service.getByTarget(dto);

      expect(result).toHaveLength(1);
      expect(result[0].target_id).toBe('member-789');
    });

    it('queries with target_id parameter', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      await service.getByTarget(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE target_id = {target_id:String}'),
        expect.objectContaining({ target_id: 'member-789' }),
      );
    });

    it('parses metadata JSON correctly', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      const result = await service.getByTarget(dto);

      expect(result[0].metadata).toEqual({
        role: 'admin',
        email: 'user@example.com',
      });
    });

    it('uses default limit of 100', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      await service.getByTarget(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('uses default offset of 0', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      await service.getByTarget(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ offset: 0 }),
      );
    });

    it('uses custom limit when provided', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';
      dto.limit = 50;

      await service.getByTarget(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('uses custom offset when provided', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';
      dto.offset = 100;

      await service.getByTarget(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ offset: 100 }),
      );
    });

    it('orders results by created_at DESC', async () => {
      clickhouse.querySystem.mockResolvedValue([mockAuditLogRow]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      await service.getByTarget(dto);

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Object),
      );
    });

    it('returns empty array when no logs match', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'non-existent';

      const result = await service.getByTarget(dto);

      expect(result).toEqual([]);
    });

    it('returns multiple logs for same target', async () => {
      const mockLog1 = {
        ...mockAuditLogRow,
        id: 'audit-1',
        action: 'member.added',
        created_at: '2025-01-01 12:00:00',
      };
      const mockLog2 = {
        ...mockAuditLogRow,
        id: 'audit-2',
        action: 'member.role_changed',
        created_at: '2025-01-02 12:00:00',
      };
      const mockLog3 = {
        ...mockAuditLogRow,
        id: 'audit-3',
        action: 'member.removed',
        created_at: '2025-01-03 12:00:00',
      };

      clickhouse.querySystem.mockResolvedValue([mockLog1, mockLog2, mockLog3]);

      const dto = new GetAuditByTargetDto();
      dto.target_id = 'member-789';

      const result = await service.getByTarget(dto);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('audit-1');
      expect(result[1].id).toBe('audit-2');
      expect(result[2].id).toBe('audit-3');
    });

    it('supports pagination through large result sets', async () => {
      const generateMockLog = (index: number) => ({
        ...mockAuditLogRow,
        id: `audit-${index}`,
      });

      // First page
      clickhouse.querySystem.mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => generateMockLog(i)),
      );

      const dto1 = new GetAuditByTargetDto();
      dto1.target_id = 'member-789';
      dto1.limit = 50;
      dto1.offset = 0;

      const result1 = await service.getByTarget(dto1);
      expect(result1).toHaveLength(50);

      // Second page
      clickhouse.querySystem.mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => generateMockLog(i + 50)),
      );

      const dto2 = new GetAuditByTargetDto();
      dto2.target_id = 'member-789';
      dto2.limit = 50;
      dto2.offset = 50;

      const result2 = await service.getByTarget(dto2);
      expect(result2).toHaveLength(50);
      expect(result2[0].id).toBe('audit-50');
    });
  });
});
