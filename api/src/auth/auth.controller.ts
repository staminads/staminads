import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('auth.login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
