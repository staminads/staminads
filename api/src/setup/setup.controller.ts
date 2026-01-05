import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SetupService } from './setup.service';
import { InitializeDto } from './dto/initialize.dto';

@ApiTags('setup')
@Controller('api')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Public()
  @Get('setup.status')
  @ApiOperation({ summary: 'Check if initial setup is complete' })
  @ApiResponse({
    status: 200,
    description: 'Setup status',
    schema: {
      type: 'object',
      properties: {
        setupCompleted: { type: 'boolean' },
      },
    },
  })
  async status(): Promise<{ setupCompleted: boolean }> {
    const setupCompleted = await this.setupService.isSetupComplete();
    return { setupCompleted };
  }

  @Public()
  @Post('setup.initialize')
  @ApiOperation({ summary: 'Initialize the application with the first admin user' })
  @ApiResponse({
    status: 201,
    description: 'Admin user created successfully',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            is_super_admin: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Setup already completed or user already exists',
  })
  async initialize(@Body() dto: InitializeDto): Promise<{
    access_token: string;
    user: { id: string; email: string; name: string; is_super_admin: boolean };
  }> {
    return this.setupService.createInitialAdmin(
      dto.email,
      dto.password,
      dto.name,
    );
  }
}
