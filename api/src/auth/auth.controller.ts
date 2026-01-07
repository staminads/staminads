import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Request,
  UseGuards,
  Headers,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { AuthThrottle } from '../common/decorators/throttle.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PublicSession } from '../common/entities';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth.login')
  @Public()
  @AuthThrottle()
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 201,
    description: 'Login successful',
    schema: {
      properties: {
        access_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const ipAddress = forwardedFor?.split(',')[0].trim();
    return this.authService.login(dto, ipAddress, userAgent);
  }

  @Post('auth.forgotPassword')
  @Public()
  @AuthThrottle()
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({
    status: 201,
    description: 'Reset email sent (if email exists)',
    schema: {
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ): Promise<{ success: boolean }> {
    const ipAddress = forwardedFor?.split(',')[0].trim();
    await this.authService.forgotPassword(dto, ipAddress);
    return { success: true };
  }

  @Post('auth.resetPassword')
  @HttpCode(200)
  @Public()
  @AuthThrottle()
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({
    status: 200,
    description: 'Password reset successful',
    schema: {
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ): Promise<{ success: boolean }> {
    const ipAddress = forwardedFor?.split(',')[0].trim();
    await this.authService.resetPassword(dto, ipAddress);
    return { success: true };
  }

  @Get('auth.sessions')
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'List active sessions' })
  @ApiResponse({
    status: 200,
    description: 'List of active sessions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          user_id: { type: 'string' },
          ip_address: { type: 'string', nullable: true },
          user_agent: { type: 'string', nullable: true },
          expires_at: { type: 'string' },
          revoked_at: { type: 'string', nullable: true },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
      },
    },
  })
  async sessions(
    @Request() req: Request & { user: { id: string } },
  ): Promise<PublicSession[]> {
    return this.authService.listSessions(req.user.id);
  }

  @Post('auth.revokeSession')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiQuery({ name: 'sessionId', type: String, required: true })
  @ApiResponse({
    status: 200,
    description: 'Session revoked',
    schema: {
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  async revokeSession(
    @Request() req: Request & { user: { id: string } },
    @Query('sessionId') sessionId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.revokeSession(sessionId, req.user.id);
    return { success: true };
  }

  @Post('auth.revokeAllSessions')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('jwt-auth')
  @ApiOperation({ summary: 'Logout from all devices' })
  @ApiResponse({
    status: 200,
    description: 'All sessions revoked',
    schema: {
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  async revokeAllSessions(
    @Request() req: Request & { user: { id: string } },
  ): Promise<{ success: boolean }> {
    await this.authService.revokeAllSessions(req.user.id);
    return { success: true };
  }
}
