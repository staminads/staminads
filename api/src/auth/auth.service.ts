import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');

    if (
      loginDto.email !== adminEmail ||
      loginDto.password !== adminPassword
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: 'admin', email: adminEmail };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
