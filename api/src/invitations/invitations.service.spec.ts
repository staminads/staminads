import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from './invitations.service';
import { ClickHouseService } from '../database/clickhouse.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import * as crypto from '../common/crypto';
import {
  Invitation,
  InvitationWithInviter,
  WorkspaceMembership,
} from '../common/entities';
import { User } from '../common/entities/user.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';

// Mock crypto utilities
jest.mock('../common/crypto', () => ({
  generateId: jest.fn(),
  generateToken: jest.fn(),
  hashToken: jest.fn(),
  verifyTokenHash: jest.fn(),
}));

describe('InvitationsService', () => {
  let service: InvitationsService;
  let clickhouse: jest.Mocked<ClickHouseService>;
  let usersService: jest.Mocked<UsersService>;
  let mailService: jest.Mocked<MailService>;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let configService: jest.Mocked<ConfigService>;

  const mockWorkspace: Workspace = {
    id: 'ws-test-001',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    logo_url: 'https://example.com/logo.png',
    status: 'active',
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
    settings: {
      timescore_reference: 60,
      bounce_threshold: 10,
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
    },
  };

  const mockUser: User = {
    id: 'user-001',
    email: 'user@example.com',
    password_hash: 'hashed-password',
    name: 'Test User',
    type: 'user',
    status: 'active',
    is_super_admin: false,
    last_login_at: null,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: '2025-01-01 00:00:00',
    deleted_at: null,
    deleted_by: null,
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  const mockInviter: User = {
    ...mockUser,
    id: 'inviter-001',
    email: 'inviter@example.com',
    name: 'Inviter User',
  };

  const mockInvitation: Invitation = {
    id: 'inv-001',
    workspace_id: 'ws-test-001',
    email: 'invitee@example.com',
    role: 'editor',
    token_hash: 'hashed-token',
    invited_by: 'inviter-001',
    status: 'pending',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: null,
    revoked_at: null,
    revoked_by: null,
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: ClickHouseService,
          useValue: {
            querySystem: jest.fn(),
            insertSystem: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
            findByEmail: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendInvitation: jest.fn(),
            sendWelcome: jest.fn(),
          },
        },
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn(),
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

    service = module.get<InvitationsService>(InvitationsService);
    clickhouse = module.get(ClickHouseService);
    usersService = module.get(UsersService);
    mailService = module.get(MailService);
    workspacesService = module.get(WorkspacesService);
    configService = module.get(ConfigService);

    // Default config mock
    configService.get.mockReturnValue('http://localhost:5173');

    // Reset crypto mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns pending invitations for workspace with inviter info', async () => {
      const invitationWithInviter: InvitationWithInviter = {
        ...mockInvitation,
        inviter: {
          id: mockInviter.id,
          name: mockInviter.name,
          email: mockInviter.email,
        },
      };

      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      usersService.findById.mockResolvedValue(mockInviter);

      const result = await service.list('ws-test-001');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'inv-001',
        email: 'invitee@example.com',
        role: 'editor',
        inviter: {
          id: 'inviter-001',
          name: 'Inviter User',
          email: 'inviter@example.com',
        },
      });
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('WHERE workspace_id ='),
        { workspaceId: 'ws-test-001' },
      );
    });

    it('returns empty array when no pending invitations', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.list('ws-test-001');

      expect(result).toEqual([]);
    });

    it('handles missing inviter gracefully', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      usersService.findById.mockResolvedValue(null);

      const result = await service.list('ws-test-001');

      expect(result).toHaveLength(1);
      expect(result[0].inviter).toEqual({
        id: '',
        name: 'Unknown',
        email: '',
      });
    });

    it('only returns pending and non-expired invitations', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await service.list('ws-test-001');

      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining("AND status = 'pending'"),
        expect.any(Object),
      );
      expect(clickhouse.querySystem).toHaveBeenCalledWith(
        expect.stringContaining('AND expires_at > now()'),
        expect.any(Object),
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      (crypto.generateId as jest.Mock).mockReturnValue('inv-new-001');
      (crypto.generateToken as jest.Mock).mockReturnValue({
        token: 'raw-token-123',
        hash: 'hashed-token-123',
      });
    });

    it('creates invitation and sends email', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      clickhouse.querySystem.mockResolvedValue([]); // No existing membership
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockInviter);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      const result = await service.create(
        {
          workspace_id: 'ws-test-001',
          email: 'newuser@example.com',
          role: 'editor',
        },
        'inviter-001',
      );

      expect(result).toMatchObject({
        id: 'inv-new-001',
        workspace_id: 'ws-test-001',
        email: 'newuser@example.com',
        role: 'editor',
        token_hash: 'hashed-token-123',
        invited_by: 'inviter-001',
        status: 'pending',
      });

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'invitations',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'inv-new-001',
            email: 'newuser@example.com',
            token_hash: 'hashed-token-123',
          }),
        ]),
      );
    });

    it('sends invitation email with correct details', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      clickhouse.querySystem.mockResolvedValue([]);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockInviter);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      await service.create(
        {
          workspace_id: 'ws-test-001',
          email: 'newuser@example.com',
          role: 'editor',
        },
        'inviter-001',
      );

      expect(mailService.sendInvitation).toHaveBeenCalledWith(
        'ws-test-001',
        'newuser@example.com',
        {
          inviterName: 'Inviter User',
          workspaceName: 'Test Workspace',
          role: 'editor',
          inviteUrl: 'http://localhost:5173/invite/raw-token-123',
          workspaceWebsite: 'https://example.com',
        },
      );
    });

    it('lowercases email before storing', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      clickhouse.querySystem.mockResolvedValue([]);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockInviter);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      await service.create(
        {
          workspace_id: 'ws-test-001',
          email: 'NewUser@Example.COM',
          role: 'editor',
        },
        'inviter-001',
      );

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'invitations',
        expect.arrayContaining([
          expect.objectContaining({
            email: 'newuser@example.com',
          }),
        ]),
      );
    });

    it('throws NotFoundException when workspace does not exist', async () => {
      workspacesService.get.mockResolvedValue(null as unknown as Workspace);

      await expect(
        service.create(
          {
            workspace_id: 'non-existent',
            email: 'user@example.com',
            role: 'editor',
          },
          'inviter-001',
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.create(
          {
            workspace_id: 'non-existent',
            email: 'user@example.com',
            role: 'editor',
          },
          'inviter-001',
        ),
      ).rejects.toThrow('Workspace not found');
    });

    it('throws ConflictException when user is already a member', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findByEmail.mockResolvedValue(mockUser);
      clickhouse.querySystem.mockResolvedValue([
        {
          id: 'membership-001',
          workspace_id: 'ws-test-001',
          user_id: 'user-001',
          role: 'viewer',
        } as WorkspaceMembership,
      ]);

      await expect(
        service.create(
          {
            workspace_id: 'ws-test-001',
            email: 'user@example.com',
            role: 'editor',
          },
          'inviter-001',
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create(
          {
            workspace_id: 'ws-test-001',
            email: 'user@example.com',
            role: 'editor',
          },
          'inviter-001',
        ),
      ).rejects.toThrow('User is already a member of this workspace');
    });

    it('throws ConflictException when invitation already pending', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findByEmail.mockResolvedValue(null);
      clickhouse.querySystem.mockResolvedValue([mockInvitation]); // Existing invitation

      await expect(
        service.create(
          {
            workspace_id: 'ws-test-001',
            email: 'invitee@example.com',
            role: 'editor',
          },
          'inviter-001',
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create(
          {
            workspace_id: 'ws-test-001',
            email: 'invitee@example.com',
            role: 'editor',
          },
          'inviter-001',
        ),
      ).rejects.toThrow(
        'Invitation already pending for this email. Use resend to send again.',
      );
    });

    it('sets expiry date to 7 days from now', async () => {
      const beforeCreate = Date.now();

      workspacesService.get.mockResolvedValue(mockWorkspace);
      clickhouse.querySystem.mockResolvedValue([]);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockInviter);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      await service.create(
        {
          workspace_id: 'ws-test-001',
          email: 'newuser@example.com',
          role: 'editor',
        },
        'inviter-001',
      );

      const afterCreate = Date.now();
      const insertCall = clickhouse.insertSystem.mock.calls[0] as [
        string,
        Invitation[],
      ];
      const invitation = insertCall[1][0];
      // Parse ClickHouse DateTime format as UTC
      const expiresAt = new Date(
        invitation.expires_at.replace(' ', 'T') + 'Z',
      ).getTime();
      const expectedMin = beforeCreate + 7 * 24 * 60 * 60 * 1000 - 1000;
      const expectedMax = afterCreate + 7 * 24 * 60 * 60 * 1000 + 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('resend', () => {
    beforeEach(() => {
      (crypto.generateToken as jest.Mock).mockReturnValue({
        token: 'new-token-456',
        hash: 'new-hash-456',
      });
    });

    it('generates new token and sends new email', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findById.mockResolvedValue(mockInviter);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      await service.resend('inv-001', 'inviter-001');

      expect(crypto.generateToken).toHaveBeenCalled();
      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'invitations',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'inv-001',
            token_hash: 'new-hash-456',
          }),
        ]),
      );
      expect(mailService.sendInvitation).toHaveBeenCalledWith(
        'ws-test-001',
        'invitee@example.com',
        expect.objectContaining({
          inviteUrl: 'http://localhost:5173/invite/new-token-456',
        }),
      );
    });

    it('updates expiry date to 7 days from now', async () => {
      const beforeResend = Date.now();

      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findById.mockResolvedValue(mockInviter);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      mailService.sendInvitation.mockResolvedValue(undefined);

      await service.resend('inv-001', 'inviter-001');

      const afterResend = Date.now();
      const insertCall = clickhouse.insertSystem.mock.calls[0] as [
        string,
        Invitation[],
      ];
      const invitation = insertCall[1][0];
      // Parse ClickHouse DateTime format as UTC
      const expiresAt = new Date(
        invitation.expires_at.replace(' ', 'T') + 'Z',
      ).getTime();
      const expectedMin = beforeResend + 7 * 24 * 60 * 60 * 1000 - 1000;
      const expectedMax = afterResend + 7 * 24 * 60 * 60 * 1000 + 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });

    it('throws NotFoundException when invitation does not exist', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.resend('non-existent', 'inviter-001'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.resend('non-existent', 'inviter-001'),
      ).rejects.toThrow('Invitation not found');
    });

    it('throws BadRequestException when invitation is not pending', async () => {
      const acceptedInvitation = {
        ...mockInvitation,
        status: 'accepted' as const,
      };
      clickhouse.querySystem.mockResolvedValue([acceptedInvitation]);

      await expect(service.resend('inv-001', 'inviter-001')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resend('inv-001', 'inviter-001')).rejects.toThrow(
        'Can only resend pending invitations',
      );
    });
  });

  describe('revoke', () => {
    it('marks invitation as revoked', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      clickhouse.insertSystem.mockResolvedValue(undefined);

      await service.revoke('inv-001', 'revoker-001');

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'invitations',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'inv-001',
            status: 'revoked',
            revoked_by: 'revoker-001',
            revoked_at: expect.any(String),
          }),
        ]),
      );
    });

    it('throws NotFoundException when invitation does not exist', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.revoke('non-existent', 'revoker-001'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.revoke('non-existent', 'revoker-001'),
      ).rejects.toThrow('Invitation not found');
    });

    it('throws BadRequestException when invitation is not pending', async () => {
      const revokedInvitation = {
        ...mockInvitation,
        status: 'revoked' as const,
      };
      clickhouse.querySystem.mockResolvedValue([revokedInvitation]);

      await expect(service.revoke('inv-001', 'revoker-001')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.revoke('inv-001', 'revoker-001')).rejects.toThrow(
        'Can only revoke pending invitations',
      );
    });
  });

  describe('getByToken', () => {
    beforeEach(() => {
      (crypto.hashToken as jest.Mock).mockReturnValue('hashed-token');
    });

    it('returns invitation details for valid token', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findById.mockResolvedValue(mockInviter);
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.getByToken('raw-token-123');

      expect(result).toMatchObject({
        id: 'inv-001',
        workspace: {
          id: 'ws-test-001',
          name: 'Test Workspace',
          website: 'https://example.com',
          logo_url: 'https://example.com/logo.png',
        },
        email: 'invitee@example.com',
        role: 'editor',
        inviter: {
          name: 'Inviter User',
        },
        existingUser: false,
      });
      expect(crypto.hashToken).toHaveBeenCalledWith('raw-token-123');
    });

    it('returns existingUser=true when user already exists', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findById.mockResolvedValue(mockInviter);
      usersService.findByEmail.mockResolvedValue(mockUser);

      const result = await service.getByToken('raw-token-123');

      expect(result?.existingUser).toBe(true);
    });

    it('returns null for invalid token', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      const result = await service.getByToken('invalid-token');

      expect(result).toBeNull();
    });

    it('throws BadRequestException for expired invitation', async () => {
      const pastDate = new Date(Date.now() - 1000);
      // ClickHouse format: YYYY-MM-DD HH:MM:SS.SSS (no T, no Z)
      const clickhouseDate = pastDate
        .toISOString()
        .replace('T', ' ')
        .slice(0, -1);
      const expiredInvitation = {
        ...mockInvitation,
        expires_at: clickhouseDate,
      };
      clickhouse.querySystem
        .mockResolvedValueOnce([expiredInvitation])
        .mockResolvedValueOnce([expiredInvitation]);

      await expect(service.getByToken('raw-token-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getByToken('raw-token-123')).rejects.toThrow(
        'This invitation has expired',
      );
    });

    it('throws BadRequestException for accepted invitation', async () => {
      const acceptedInvitation = {
        ...mockInvitation,
        status: 'accepted' as const,
      };
      clickhouse.querySystem.mockResolvedValue([acceptedInvitation]);

      await expect(service.getByToken('raw-token-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getByToken('raw-token-123')).rejects.toThrow(
        'This invitation has already been accepted',
      );
    });

    it('throws BadRequestException for revoked invitation', async () => {
      const revokedInvitation = {
        ...mockInvitation,
        status: 'revoked' as const,
      };
      clickhouse.querySystem.mockResolvedValue([revokedInvitation]);

      await expect(service.getByToken('raw-token-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getByToken('raw-token-123')).rejects.toThrow(
        'This invitation is no longer valid',
      );
    });

    it('handles missing inviter gracefully', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      usersService.findById.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.getByToken('raw-token-123');

      expect(result?.inviter.name).toBe('Unknown');
    });
  });

  describe('accept', () => {
    beforeEach(() => {
      (crypto.hashToken as jest.Mock).mockReturnValue('hashed-token');
      (crypto.generateId as jest.Mock).mockReturnValue('membership-new-001');
    });

    describe('new user flow', () => {
      it('creates user and membership for new user', async () => {
        const newUser = {
          id: 'user-new-001',
          email: 'invitee@example.com',
          name: 'New User',
          status: 'active' as const,
          created_at: '2025-01-01 00:00:00',
        };

        clickhouse.querySystem.mockResolvedValue([mockInvitation]);
        usersService.findByEmail.mockResolvedValue(null);
        usersService.create.mockResolvedValue(newUser);
        usersService.findById.mockResolvedValue({
          ...mockUser,
          id: 'user-new-001',
          name: 'New User',
        });
        clickhouse.insertSystem.mockResolvedValue(undefined);
        workspacesService.get.mockResolvedValue(mockWorkspace);
        mailService.sendWelcome.mockResolvedValue(undefined);

        const result = await service.accept(
          {
            token: 'raw-token-123',
            name: 'New User',
            password: 'password123',
          },
          undefined,
        );

        expect(result).toEqual({
          userId: 'user-new-001',
          workspaceId: 'ws-test-001',
        });

        expect(usersService.create).toHaveBeenCalledWith({
          email: 'invitee@example.com',
          name: 'New User',
          password: 'password123',
        });
      });

      it('throws BadRequestException when name is missing for new user', async () => {
        clickhouse.querySystem.mockResolvedValue([mockInvitation]);
        usersService.findByEmail.mockResolvedValue(null);

        await expect(
          service.accept(
            {
              token: 'raw-token-123',
              password: 'password123',
            },
            undefined,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.accept(
            {
              token: 'raw-token-123',
              password: 'password123',
            },
            undefined,
          ),
        ).rejects.toThrow('Name and password are required for new users');
      });

      it('throws BadRequestException when password is missing for new user', async () => {
        clickhouse.querySystem.mockResolvedValue([mockInvitation]);
        usersService.findByEmail.mockResolvedValue(null);

        await expect(
          service.accept(
            {
              token: 'raw-token-123',
              name: 'New User',
            },
            undefined,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.accept(
            {
              token: 'raw-token-123',
              name: 'New User',
            },
            undefined,
          ),
        ).rejects.toThrow('Name and password are required for new users');
      });
    });

    describe('existing user flow', () => {
      it('creates membership for existing user', async () => {
        clickhouse.querySystem.mockResolvedValue([mockInvitation]);
        usersService.findByEmail.mockResolvedValue(mockUser);
        usersService.findById.mockResolvedValue(mockUser);
        clickhouse.insertSystem.mockResolvedValue(undefined);
        workspacesService.get.mockResolvedValue(mockWorkspace);
        mailService.sendWelcome.mockResolvedValue(undefined);

        const result = await service.accept(
          {
            token: 'raw-token-123',
          },
          'user-001',
        );

        expect(result).toEqual({
          userId: 'user-001',
          workspaceId: 'ws-test-001',
        });

        expect(usersService.create).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException when logged-in user email does not match invitation', async () => {
        clickhouse.querySystem.mockResolvedValue([mockInvitation]);
        usersService.findByEmail.mockResolvedValue({
          ...mockUser,
          id: 'different-user-001',
        });

        await expect(
          service.accept(
            {
              token: 'raw-token-123',
            },
            'user-001',
          ),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          service.accept(
            {
              token: 'raw-token-123',
            },
            'user-001',
          ),
        ).rejects.toThrow('This invitation is for a different email address');
      });
    });

    it('creates workspace membership with correct details', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      mailService.sendWelcome.mockResolvedValue(undefined);

      await service.accept(
        {
          token: 'raw-token-123',
        },
        'user-001',
      );

      expect(clickhouse.insertSystem).toHaveBeenCalledWith(
        'workspace_memberships',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'membership-new-001',
            workspace_id: 'ws-test-001',
            user_id: 'user-001',
            role: 'editor',
            invited_by: 'inviter-001',
          }),
        ]),
      );
    });

    it('marks invitation as accepted', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      mailService.sendWelcome.mockResolvedValue(undefined);

      await service.accept(
        {
          token: 'raw-token-123',
        },
        'user-001',
      );

      const invitationInsertCall = clickhouse.insertSystem.mock.calls.find(
        (call) => call[0] === 'invitations',
      );
      expect(invitationInsertCall).toBeDefined();
      expect(invitationInsertCall?.[1][0]).toMatchObject({
        id: 'inv-001',
        status: 'accepted',
        accepted_at: expect.any(String),
      });
    });

    it('sends welcome email after acceptance', async () => {
      clickhouse.querySystem.mockResolvedValue([mockInvitation]);
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.findById.mockResolvedValue(mockUser);
      clickhouse.insertSystem.mockResolvedValue(undefined);
      workspacesService.get.mockResolvedValue(mockWorkspace);
      mailService.sendWelcome.mockResolvedValue(undefined);

      await service.accept(
        {
          token: 'raw-token-123',
        },
        'user-001',
      );

      expect(mailService.sendWelcome).toHaveBeenCalledWith(
        'ws-test-001',
        'invitee@example.com',
        {
          userName: 'Test User',
          workspaceName: 'Test Workspace',
          role: 'editor',
          dashboardUrl: 'http://localhost:5173/workspaces/ws-test-001',
        },
      );
    });

    it('throws BadRequestException for invalid token', async () => {
      clickhouse.querySystem.mockResolvedValue([]);

      await expect(
        service.accept(
          {
            token: 'invalid-token',
          },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.accept(
          {
            token: 'invalid-token',
          },
          undefined,
        ),
      ).rejects.toThrow('Invalid invitation token');
    });

    it('throws BadRequestException for expired invitation', async () => {
      const pastDate = new Date(Date.now() - 1000);
      // ClickHouse format: YYYY-MM-DD HH:MM:SS.SSS (no T, no Z)
      const clickhouseDate = pastDate
        .toISOString()
        .replace('T', ' ')
        .slice(0, -1);
      const expiredInvitation = {
        ...mockInvitation,
        expires_at: clickhouseDate,
      };
      clickhouse.querySystem
        .mockResolvedValueOnce([expiredInvitation])
        .mockResolvedValueOnce([expiredInvitation]);
      // Mock no existing user
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.accept(
          {
            token: 'raw-token-123',
            name: 'New User',
            password: 'password123',
          },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.accept(
          {
            token: 'raw-token-123',
            name: 'New User',
            password: 'password123',
          },
          undefined,
        ),
      ).rejects.toThrow('This invitation has expired');
    });

    it('throws BadRequestException for already accepted invitation', async () => {
      const acceptedInvitation = {
        ...mockInvitation,
        status: 'accepted' as const,
      };
      clickhouse.querySystem.mockResolvedValue([acceptedInvitation]);

      await expect(
        service.accept(
          {
            token: 'raw-token-123',
          },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.accept(
          {
            token: 'raw-token-123',
          },
          undefined,
        ),
      ).rejects.toThrow('This invitation has already been accepted');
    });

    it('throws BadRequestException for revoked invitation', async () => {
      const revokedInvitation = {
        ...mockInvitation,
        status: 'revoked' as const,
      };
      clickhouse.querySystem.mockResolvedValue([revokedInvitation]);

      await expect(
        service.accept(
          {
            token: 'raw-token-123',
          },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.accept(
          {
            token: 'raw-token-123',
          },
          undefined,
        ),
      ).rejects.toThrow('This invitation is no longer valid');
    });
  });
});
