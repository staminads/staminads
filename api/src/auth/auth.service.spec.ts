import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);

    // Default config mock
    configService.get.mockImplementation((key: string) => {
      if (key === 'ADMIN_EMAIL') return 'admin@example.com';
      if (key === 'ADMIN_PASSWORD') return 'secret123';
      return undefined;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('returns access_token for valid credentials', async () => {
      const result = await service.login({
        email: 'admin@example.com',
        password: 'secret123',
      });

      expect(result).toHaveProperty('access_token');
      expect(result.access_token).toBe('mock-jwt-token');
    });

    it('signs JWT with correct payload', async () => {
      await service.login({
        email: 'admin@example.com',
        password: 'secret123',
      });

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'admin',
        email: 'admin@example.com',
      });
    });

    it('throws UnauthorizedException for wrong email', async () => {
      await expect(
        service.login({
          email: 'wrong@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.login({
          email: 'wrong@example.com',
          password: 'secret123',
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('throws UnauthorizedException for wrong password', async () => {
      await expect(
        service.login({
          email: 'admin@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for both wrong credentials', async () => {
      await expect(
        service.login({
          email: 'wrong@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('uses credentials from environment config', async () => {
      // Override config with different credentials
      configService.get.mockImplementation((key: string) => {
        if (key === 'ADMIN_EMAIL') return 'custom@admin.com';
        if (key === 'ADMIN_PASSWORD') return 'custompass';
        return undefined;
      });

      // Should work with new credentials
      const result = await service.login({
        email: 'custom@admin.com',
        password: 'custompass',
      });

      expect(result.access_token).toBe('mock-jwt-token');
    });

    it('is case-sensitive for email', async () => {
      await expect(
        service.login({
          email: 'ADMIN@EXAMPLE.COM',
          password: 'secret123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('is case-sensitive for password', async () => {
      await expect(
        service.login({
          email: 'admin@example.com',
          password: 'SECRET123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
