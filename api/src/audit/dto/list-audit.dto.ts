import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AuditAction,
  AuditTargetType,
} from '../../common/entities/audit-log.entity';

export class ListAuditDto {
  @IsOptional()
  @IsString()
  workspace_id?: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  action?: AuditAction;

  @IsOptional()
  @IsString()
  target_type?: AuditTargetType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  limit?: number = 100;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;
}
