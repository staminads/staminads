import {
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceAuthGuard } from './workspace.guard';
import { ApiKeyPayload } from '../../auth/strategies/api-key.strategy';
import { MembersService } from '../../members/members.service';
import { WorkspaceMembership } from '../entities/membership.entity';

describe('WorkspaceAuthGuard', () => {
  let guard: WorkspaceAuthGuard;
  let mockReflector: jest.Mocked<Reflector>;
  let mockMembersService: jest.Mocked<MembersService>;

  const mockApiKeyUser: ApiKeyPayload = {
    type: 'api-key',
    keyId: 'key-001',
    workspaceId: 'ws-001',
    scopes: ['events.track'],
  };

  const mockJwtUser = {
    id: 'user-001',
    email: 'test@example.com',
  };

  const mockMembership: WorkspaceMembership = {
    id: 'membership-001',
    workspace_id: 'ws-001',
    user_id: 'user-001',
    role: 'admin',
    invited_by: null,
    joined_at: '2024-01-01 00:00:00',
    created_at: '2024-01-01 00:00:00',
    updated_at: '2024-01-01 00:00:00',
  };

  const createMockContext = (
    user: unknown,
    body: Record<string, unknown>,
    query: Record<string, unknown> = {},
    method = 'POST',
  ): ExecutionContext => {
    const mockRequest = { user, body, query, method };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<Reflector>;

    mockMembersService = {
      getMembership: jest.fn(),
    } as unknown as jest.Mocked<MembersService>;

    guard = new WorkspaceAuthGuard(mockReflector, mockMembersService);
  });

  describe('API Key auth', () => {
    it('allows access when workspace_id matches API key workspace', async () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: 'ws-001',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('throws ForbiddenException when workspace_id does not match', async () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: 'ws-002',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'API key not authorized for this workspace',
      );
    });

    it('validates exact workspace_id match (case-sensitive)', async () => {
      const context = createMockContext(mockApiKeyUser, {
        workspace_id: 'WS-001',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('JWT auth', () => {
    it('allows access when user is a member of the workspace', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      const context = createMockContext(mockJwtUser, {
        workspace_id: 'ws-001',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockMembersService.getMembership).toHaveBeenCalledWith(
        'ws-001',
        'user-001',
      );
    });

    it('throws ForbiddenException when user is not a member', async () => {
      mockMembersService.getMembership.mockResolvedValue(null);
      const context = createMockContext(mockJwtUser, {
        workspace_id: 'ws-001',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Not a member of this workspace',
      );
    });

    it('attaches membership to request', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      const mockRequest = {
        user: mockJwtUser,
        body: { workspace_id: 'ws-001' },
        query: {},
        method: 'POST',
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(mockRequest).toHaveProperty('membership', mockMembership);
    });
  });

  describe('workspace_id extraction', () => {
    it('throws BadRequestException when no workspace_id provided', async () => {
      const context = createMockContext(mockJwtUser, {});

      await expect(guard.canActivate(context)).rejects.toThrow(
        BadRequestException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'workspace_id is required',
      );
    });

    it('extracts workspace_id from body for POST requests', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      const context = createMockContext(
        mockJwtUser,
        { workspace_id: 'ws-001' },
        {},
        'POST',
      );

      await guard.canActivate(context);

      expect(mockMembersService.getMembership).toHaveBeenCalledWith(
        'ws-001',
        'user-001',
      );
    });

    it('extracts workspace_id from query for GET requests', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      const context = createMockContext(
        mockJwtUser,
        {},
        { workspace_id: 'ws-001' },
        'GET',
      );

      await guard.canActivate(context);

      expect(mockMembersService.getMembership).toHaveBeenCalledWith(
        'ws-001',
        'user-001',
      );
    });

    it('extracts workspaceId (camelCase) from query', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      const context = createMockContext(
        mockJwtUser,
        {},
        { workspaceId: 'ws-001' },
        'GET',
      );

      await guard.canActivate(context);

      expect(mockMembersService.getMembership).toHaveBeenCalledWith(
        'ws-001',
        'user-001',
      );
    });

    it('extracts id from body (for workspaces controller)', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      const context = createMockContext(mockJwtUser, { id: 'ws-001' });

      await guard.canActivate(context);

      expect(mockMembersService.getMembership).toHaveBeenCalledWith(
        'ws-001',
        'user-001',
      );
    });
  });

  describe('permission checking', () => {
    it('allows access when no permission required', async () => {
      mockMembersService.getMembership.mockResolvedValue(mockMembership);
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockContext(mockJwtUser, {
        workspace_id: 'ws-001',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('allows access when user has required permission', async () => {
      const adminMembership = { ...mockMembership, role: 'admin' as const };
      mockMembersService.getMembership.mockResolvedValue(adminMembership);
      mockReflector.getAllAndOverride.mockReturnValue('workspace.settings');
      const context = createMockContext(mockJwtUser, {
        workspace_id: 'ws-001',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('throws ForbiddenException when user lacks permission', async () => {
      const viewerMembership = { ...mockMembership, role: 'viewer' as const };
      mockMembersService.getMembership.mockResolvedValue(viewerMembership);
      mockReflector.getAllAndOverride.mockReturnValue('workspace.settings');
      const context = createMockContext(mockJwtUser, {
        workspace_id: 'ws-001',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Insufficient permissions',
      );
    });
  });
});
