import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DemoRestricted } from '../common/decorators/demo-restricted.decorator';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PublicUser } from '../common/entities/user.entity';

@ApiTags('auth')
@ApiSecurity('jwt-auth')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get('auth.me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  async me(
    @Req() req: Request & { user: { id: string } },
  ): Promise<PublicUser> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new Error('User not found');
    }
    return this.usersService.toPublicUser(user);
  }

  @Post('auth.updateProfile')
  @DemoRestricted()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 201, description: 'Updated user profile' })
  async updateProfile(
    @Req() req: any,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Post('auth.changePassword')
  @DemoRestricted()
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 201, description: 'Password changed successfully' })
  async changePassword(
    @Req() req: any,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean }> {
    await this.usersService.changePassword(req.user.id, dto);

    // Revoke all sessions to force re-login on all devices
    await this.authService.revokeAllSessions(req.user.id);

    return { success: true };
  }
}
