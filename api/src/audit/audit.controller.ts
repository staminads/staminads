import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { ListAuditDto } from './dto/list-audit.dto';
import { GetAuditByTargetDto } from './dto/get-audit-by-target.dto';

@ApiTags('audit')
@ApiSecurity('jwt-auth')
@Controller('api')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('audit.list')
  @ApiOperation({ summary: 'List audit logs with optional filters' })
  @ApiQuery({ name: 'workspace_id', type: String, required: false })
  @ApiQuery({ name: 'user_id', type: String, required: false })
  @ApiQuery({ name: 'action', type: String, required: false })
  @ApiQuery({ name: 'target_type', type: String, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({ name: 'offset', type: Number, required: false })
  list(
    @Query('workspace_id') workspace_id?: string,
    @Query('user_id') user_id?: string,
    @Query('action') action?: string,
    @Query('target_type') target_type?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const dto = new ListAuditDto();
    dto.workspace_id = workspace_id;
    dto.user_id = user_id;
    dto.action = action as ListAuditDto['action'];
    dto.target_type = target_type as ListAuditDto['target_type'];
    dto.limit = limit;
    dto.offset = offset;

    return this.auditService.list(dto);
  }

  @Get('audit.getByTarget')
  @ApiOperation({ summary: 'Get audit logs for a specific target' })
  @ApiQuery({ name: 'target_id', type: String, required: true })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({ name: 'offset', type: Number, required: false })
  getByTarget(
    @Query('target_id') target_id: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const dto = new GetAuditByTargetDto();
    dto.target_id = target_id;
    dto.limit = limit;
    dto.offset = offset;

    return this.auditService.getByTarget(dto);
  }
}
