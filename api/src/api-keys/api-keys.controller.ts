import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ListApiKeysDto } from './dto/list-api-keys.dto';
import { RevokeApiKeyDto } from './dto/revoke-api-key.dto';
import { CreateApiKeyResponseDto } from './dto/create-api-key-response.dto';
import { WorkspaceAuthGuard } from '../common/guards/workspace.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';

@ApiTags('api-keys')
@ApiSecurity('jwt-auth')
@Controller('api')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post('apiKeys.create')
  @DemoRestricted()
  @UseGuards(WorkspaceAuthGuard)
  @RequirePermission('apiKeys.manage')
  @ApiOperation({ summary: 'Create a new API key' })
  @ApiResponse({
    status: 201,
    description:
      'API key created successfully. Returns the full key (only once).',
    type: CreateApiKeyResponseDto,
  })
  async create(
    @Body() dto: CreateApiKeyDto,
    @Req() req: any,
  ): Promise<CreateApiKeyResponseDto> {
    // Get user_id from authenticated user (JWT token) - fallback to dto for backwards compatibility
    const user_id = req.user?.id || dto.user_id;
    return this.apiKeysService.create({ ...dto, user_id }, user_id);
  }

  @Get('apiKeys.list')
  @ApiOperation({ summary: 'List API keys with optional filters' })
  @ApiQuery({
    name: 'user_id',
    type: String,
    required: false,
    description: 'Filter by user ID',
  })
  @ApiQuery({
    name: 'workspace_id',
    type: String,
    required: false,
    description: 'Filter by workspace ID',
  })
  @ApiQuery({
    name: 'status',
    enum: ['active', 'revoked', 'expired'],
    required: false,
    description: 'Filter by status',
  })
  async list(
    @Query('user_id') user_id?: string,
    @Query('workspace_id') workspace_id?: string,
    @Query('status') status?: 'active' | 'revoked' | 'expired',
  ) {
    const filters: ListApiKeysDto = {};
    if (user_id) filters.user_id = user_id;
    if (workspace_id !== undefined) filters.workspace_id = workspace_id;
    if (status) filters.status = status;

    return this.apiKeysService.list(filters);
  }

  @Get('apiKeys.get')
  @ApiOperation({ summary: 'Get API key by ID' })
  @ApiQuery({
    name: 'id',
    type: String,
    required: true,
    description: 'API key ID',
  })
  async get(@Query('id') id: string) {
    return this.apiKeysService.get(id);
  }

  @Post('apiKeys.revoke')
  @DemoRestricted()
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'API key ID to revoke' },
        revoked_by: {
          type: 'string',
          description: 'User ID who is revoking the key',
        },
      },
      required: ['id', 'revoked_by'],
    },
  })
  async revoke(@Body() dto: RevokeApiKeyDto) {
    return this.apiKeysService.revoke(dto);
  }
}
