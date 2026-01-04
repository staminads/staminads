import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WorkspaceGuard } from './workspace.guard';
import { ApiKeyPayload } from '../../auth/strategies/api-key.strategy';

describe('WorkspaceGuard', () => {
  let guard: WorkspaceGuard;

  const mockApiKeyUser: ApiKeyPayload = {
    type: 'api-key',
    keyId: 'key-001',
    workspaceId: 'ws-001',
    scopes: ['events.track'],
  };

  const createMockContext = (
    user: unknown,
    body: Record<string, unknown>,
  ): ExecutionContext => {
    const mockRequest = { user, body };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    guard = new WorkspaceGuard();
  });

  describe('canActivate', () => {
    it('allows access when workspace_id matches API key workspace', () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: 'ws-001',
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('throws ForbiddenException when workspace_id does not match', () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: 'ws-002',
      });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'API key not authorized for this workspace',
      );
    });

    it('allows access when no workspace_id in body', () => {
      const context = createMockContext(mockApiKeyUser, {
        event_type: 'pageview',
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when workspace_id is null', () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: null,
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when workspace_id is undefined', () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: undefined,
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when body is undefined', () => {
      const mockRequest = { user: mockApiKeyUser, body: undefined };
      const context = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when body is null', () => {
      const mockRequest = { user: mockApiKeyUser, body: null };
      const context = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access for non-API-key user (lets other guards handle)', () => {
      const jwtUser = {
        type: 'jwt',
        sub: 'user-001',
        email: 'test@example.com',
      };
      const context = createMockContext(jwtUser, {
        workspace_id: 'ws-999',
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when no user (lets other guards handle)', () => {
      const context = createMockContext(undefined, {
        workspace_id: 'ws-001',
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when user is null (lets other guards handle)', () => {
      const context = createMockContext(null, {
        workspace_id: 'ws-001',
      });

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access for empty string workspace_id (treated as not provided)', () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: '',
      });

      // Empty string is falsy in JavaScript, so it's treated as "not provided"
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('validates exact workspace_id match (case-sensitive)', () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: 'WS-001',
      });

      // 'WS-001' !== 'ws-001' - case matters
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
