import { IsString, IsOptional, IsObject } from 'class-validator';
import type {
  AuditAction,
  AuditTargetType,
} from '../../common/entities/audit-log.entity';

export class LogAuditDto {
  @IsString()
  user_id: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;

  @IsString()
  action: AuditAction;

  @IsString()
  target_type: AuditTargetType;

  @IsString()
  target_id: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  ip_address?: string;

  @IsOptional()
  @IsString()
  user_agent?: string;
}
