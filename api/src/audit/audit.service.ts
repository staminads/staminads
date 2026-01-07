import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../database/clickhouse.service';
import { AuditLog } from '../common/entities/audit-log.entity';
import { LogAuditDto } from './dto/log-audit.dto';
import { ListAuditDto } from './dto/list-audit.dto';
import { GetAuditByTargetDto } from './dto/get-audit-by-target.dto';
import { randomUUID } from 'crypto';
import { toClickHouseDateTime } from '../common/utils/datetime.util';

interface AuditLogRow extends Omit<AuditLog, 'metadata'> {
  metadata: string; // JSON string from ClickHouse
}

function parseAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : {},
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    created_at: row.created_at,
  };
}

function serializeAuditLog(
  log: AuditLog,
): Omit<AuditLog, 'metadata'> & { metadata: string } {
  return {
    id: log.id,
    user_id: log.user_id,
    workspace_id: log.workspace_id,
    action: log.action,
    target_type: log.target_type,
    target_id: log.target_id,
    metadata: JSON.stringify(log.metadata),
    ip_address: log.ip_address,
    user_agent: log.user_agent,
    created_at: log.created_at,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  /**
   * Log an audit event to ClickHouse.
   * This method can be called by other services to record audit events.
   */
  async log(dto: LogAuditDto): Promise<AuditLog> {
    const now = toClickHouseDateTime();

    const auditLog: AuditLog = {
      id: randomUUID(),
      user_id: dto.user_id,
      workspace_id: dto.workspace_id || null,
      action: dto.action,
      target_type: dto.target_type,
      target_id: dto.target_id,
      metadata: dto.metadata || {},
      ip_address: dto.ip_address || null,
      user_agent: dto.user_agent || null,
      created_at: now,
    };

    await this.clickhouse.insertSystem('audit_logs', [
      serializeAuditLog(auditLog),
    ]);

    return auditLog;
  }

  /**
   * List audit logs with optional filters.
   */
  async list(dto: ListAuditDto): Promise<AuditLog[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (dto.workspace_id) {
      conditions.push('workspace_id = {workspace_id:String}');
      params.workspace_id = dto.workspace_id;
    }

    if (dto.user_id) {
      conditions.push('user_id = {user_id:String}');
      params.user_id = dto.user_id;
    }

    if (dto.action) {
      conditions.push('action = {action:String}');
      params.action = dto.action;
    }

    if (dto.target_type) {
      conditions.push('target_type = {target_type:String}');
      params.target_type = dto.target_type;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `;

    params.limit = dto.limit || 100;
    params.offset = dto.offset || 0;

    const rows = await this.clickhouse.querySystem<AuditLogRow>(sql, params);
    return rows.map(parseAuditLog);
  }

  /**
   * Get audit logs for a specific target.
   */
  async getByTarget(dto: GetAuditByTargetDto): Promise<AuditLog[]> {
    const sql = `
      SELECT * FROM audit_logs
      WHERE target_id = {target_id:String}
      ORDER BY created_at DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `;

    const params = {
      target_id: dto.target_id,
      limit: dto.limit || 100,
      offset: dto.offset || 0,
    };

    const rows = await this.clickhouse.querySystem<AuditLogRow>(sql, params);
    return rows.map(parseAuditLog);
  }
}
