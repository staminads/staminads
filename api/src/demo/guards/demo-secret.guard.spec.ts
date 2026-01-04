import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoSecretGuard } from './demo-secret.guard';

describe('DemoSecretGuard', () => {
  let guard: DemoSecretGuard;
  let configService: ConfigService;

  const createMockExecutionContext = (querySecret?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          query: { secret: querySecret },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as ConfigService;
    guard = new DemoSecretGuard(configService);
  });

  it('throws UnauthorizedException when DEMO_SECRET not configured', () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);
    const context = createMockExecutionContext('some-secret');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow(
      'Demo endpoint not configured',
    );
  });

  it('throws UnauthorizedException when secret parameter missing', () => {
    (configService.get as jest.Mock).mockReturnValue('correct-secret');
    const context = createMockExecutionContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow(
      'Missing secret parameter',
    );
  });

  it('throws UnauthorizedException when secret is invalid', () => {
    (configService.get as jest.Mock).mockReturnValue('correct-secret');
    const context = createMockExecutionContext('wrong-secret');

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid secret');
  });

  it('returns true when secret matches', () => {
    const secret = 'my-demo-secret-123';
    (configService.get as jest.Mock).mockReturnValue(secret);
    const context = createMockExecutionContext(secret);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('uses timing-safe comparison (different length secrets rejected)', () => {
    (configService.get as jest.Mock).mockReturnValue('correct-secret');
    const context = createMockExecutionContext('short');

    expect(() => guard.canActivate(context)).toThrow('Invalid secret');
  });

  it('uses timing-safe comparison (same length different content rejected)', () => {
    (configService.get as jest.Mock).mockReturnValue('secret-aaa');
    const context = createMockExecutionContext('secret-bbb');

    expect(() => guard.canActivate(context)).toThrow('Invalid secret');
  });
});
