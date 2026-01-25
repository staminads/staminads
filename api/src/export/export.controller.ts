import { Controller, Get, Query, UseGuards, HttpCode } from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ExportService } from './export.service';
import {
  UserEventsQueryDto,
  UserEventsResponse,
} from './dto/user-events-query.dto';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';

@ApiTags('export')
@ApiSecurity('jwt-auth')
@Controller('api')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('export.userEvents')
  @HttpCode(200)
  @UseGuards(WorkspaceAuthGuard)
  @ApiOperation({
    summary: 'Export user events',
    description:
      'Export raw events for users with a user_id set. Supports cursor-based pagination for incremental sync.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user events with pagination cursor',
  })
  async getUserEvents(
    @Query() query: UserEventsQueryDto,
  ): Promise<UserEventsResponse> {
    return this.exportService.getUserEvents(query);
  }
}
