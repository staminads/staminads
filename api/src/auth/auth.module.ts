import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('ENCRYPTION_KEY');
        if (!secret) {
          throw new Error('ENCRYPTION_KEY environment variable is required');
        }
        return {
          secret,
          signOptions: {
            expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ??
              '7d') as `${number}${'s' | 'm' | 'h' | 'd'}`,
          },
        };
      },
      inject: [ConfigService],
    }),
    forwardRef(() => UsersModule),
    MailModule,
    forwardRef(() => ApiKeysModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ApiKeyStrategy],
  exports: [AuthService],
})
export class AuthModule {}
