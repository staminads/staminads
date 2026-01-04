import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeGuard } from './scope.guard';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scope.decorator';
import { ApiKeyPayload } from '../../auth/strategies/api-key.strategy';

describe('ScopeGuard', () => {
  let guard: ScopeGuard;
  let reflector: jest.Mocked<Reflector>;

  const mockApiKeyUser: ApiKeyPayload = {
    type: 'api-key',
    keyId: 'key-001',
    workspaceId: 'ws-001',
    scopes: ['events.track', 'analytics.view'],
  };

  const createMockContext = (user: unknown): ExecutionContext => {
    const mockRequest = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new ScopeGuard(reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('allows access when no scopes are required', () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockContext(mockApiKeyUser);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        REQUIRED_SCOPES_KEY,
        expect.any(Array),
      );
    });

    it('allows access when required scopes array is empty', () => {
      reflector.getAllAndOverride.mockReturnValue([]);
      const context = createMockContext(mockApiKeyUser);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when user has required scope', () => {
      reflector.getAllAndOverride.mockReturnValue(['events.track']);
      const context = createMockContext(mockApiKeyUser);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when user has one of multiple required scopes', () => {
      reflector.getAllAndOverride.mockReturnValue([
        'analytics.export',
        'analytics.view',
      ]);
      const context = createMockContext({
        ...mockApiKeyUser,
        scopes: ['analytics.view'],
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('throws ForbiddenException when user is missing required scope', () => {
      reflector.getAllAndOverride.mockReturnValue(['filters.manage']);
      const context = createMockContext(mockApiKeyUser);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Missing required scope: filters.manage',
      );
    });

    it('throws ForbiddenException with all scope options when multiple scopes required', () => {
      reflector.getAllAndOverride.mockReturnValue([
        'filters.manage',
        'annotations.manage',
      ]);
      const context = createMockContext(mockApiKeyUser);

      expect(() => guard.canActivate(context)).toThrow(
        'Missing required scope: filters.manage or annotations.manage',
      );
    });

    it('throws ForbiddenException when no user on request', () => {
      reflector.getAllAndOverride.mockReturnValue(['events.track']);
      const context = createMockContext(undefined);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('API key required');
    });

    it('throws ForbiddenException when user is null', () => {
      reflector.getAllAndOverride.mockReturnValue(['events.track']);
      const context = createMockContext(null);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('API key required');
    });

    it('throws ForbiddenException when user type is not api-key', () => {
      reflector.getAllAndOverride.mockReturnValue(['events.track']);
      const jwtUser = {
        type: 'jwt',
        sub: 'user-001',
        email: 'test@example.com',
      };
      const context = createMockContext(jwtUser);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('API key required');
    });

    it('throws ForbiddenException when user has empty scopes array', () => {
      reflector.getAllAndOverride.mockReturnValue(['events.track']);
      const context = createMockContext({
        ...mockApiKeyUser,
        scopes: [],
      });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Missing required scope: events.track',
      );
    });

    it('is case-sensitive for scope matching', () => {
      reflector.getAllAndOverride.mockReturnValue(['Events.Track']);
      const context = createMockContext(mockApiKeyUser);

      // User has 'events.track' but requirement is 'Events.Track'
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
