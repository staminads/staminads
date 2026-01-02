import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { AnthropicIntegration } from '../workspaces/entities/integration.entity';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        stream: jest.fn(),
      },
    })),
  };
});

describe('AssistantService', () => {
  let service: AssistantService;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let analyticsService: jest.Mocked<AnalyticsService>;
  let configService: jest.Mocked<ConfigService>;

  const mockIntegration: AnthropicIntegration = {
    id: 'int-1',
    type: 'anthropic',
    enabled: true,
    settings: {
      api_key_encrypted: 'encrypted-key',
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.7,
    },
    limits: {
      max_requests_per_hour: 60,
      max_tokens_per_day: 100000,
    },
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  const mockWorkspace: Workspace = {
    id: 'ws-1',
    name: 'Test Workspace',
    website: 'https://example.com',
    timezone: 'UTC',
    currency: 'USD',
    logo_url: null,
    timescore_reference: 180,
    bounce_threshold: 10,
    status: 'active',
    custom_dimensions: {},
    filters: [],
    integrations: [mockIntegration],
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
  };

  const mockWorkspaceNoIntegration: Workspace = {
    ...mockWorkspace,
    id: 'ws-no-int',
    integrations: [],
  };

  const mockWorkspaceDisabledIntegration: Workspace = {
    ...mockWorkspace,
    id: 'ws-disabled',
    integrations: [{ ...mockIntegration, enabled: false }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: WorkspacesService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            query: jest.fn(),
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

    service = module.get<AssistantService>(AssistantService);
    workspacesService = module.get(WorkspacesService);
    analyticsService = module.get(AnalyticsService);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createJob', () => {
    it('creates a job and returns job_id', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Show me sessions by device',
      });

      expect(result).toHaveProperty('job_id');
      expect(typeof result.job_id).toBe('string');
      expect(result.job_id).toHaveLength(36); // UUID format
    });

    it('throws BadRequestException when no Anthropic integration', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspaceNoIntegration);

      await expect(
        service.createJob({
          workspace_id: 'ws-no-int',
          prompt: 'Test prompt',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when integration is disabled', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspaceDisabledIntegration);

      await expect(
        service.createJob({
          workspace_id: 'ws-disabled',
          prompt: 'Test prompt',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores job with correct initial state', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test prompt',
        current_state: { metrics: ['sessions'] },
        messages: [{ role: 'user', content: 'Previous message' }],
      });

      const job = service.getJob(result.job_id);
      expect(job).toBeDefined();
      expect(job!.workspace_id).toBe('ws-1');
      expect(job!.prompt).toBe('Test prompt');
      expect(job!.current_state).toEqual({ metrics: ['sessions'] });
      expect(job!.messages).toHaveLength(1);
      expect(job!.status).toBe('pending');
    });
  });

  describe('getJob', () => {
    it('returns undefined for non-existent job', () => {
      const job = service.getJob('non-existent-id');
      expect(job).toBeUndefined();
    });

    it('returns job after creation', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      const job = service.getJob(job_id);
      expect(job).toBeDefined();
      expect(job!.id).toBe(job_id);
    });
  });

  describe('streamJob', () => {
    let mockRes: {
      write: jest.Mock;
      end: jest.Mock;
    };

    beforeEach(() => {
      mockRes = {
        write: jest.fn(),
        end: jest.fn(),
      };
    });

    it('sends error for non-existent job', async () => {
      await service.streamJob('non-existent', mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('JOB_NOT_FOUND'),
      );
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: done'),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('sends error for expired job', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      // Manually expire the job
      const job = service.getJob(job_id);
      job!.expires_at = new Date(Date.now() - 1000).toISOString();

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('JOB_EXPIRED'),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('sends cached result for completed job', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      // Manually complete the job
      const job = service.getJob(job_id);
      job!.status = 'completed';
      job!.result = {
        metrics: ['sessions'],
        dimensions: ['device'],
      };

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: config'),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('sends error for errored job', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      // Manually set job error
      const job = service.getJob(job_id);
      job!.status = 'error';
      job!.error = 'Something went wrong';

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('Something went wrong'),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('sends accumulated text for running job', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      // Set job as running with some text
      const job = service.getJob(job_id);
      job!.status = 'running';
      job!.accumulated_text = 'Partial response...';

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('Partial response...'),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('lifecycle hooks', () => {
    it('starts cleanup interval on init', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalled();

      // Clean up
      service.onModuleDestroy();
      setIntervalSpy.mockRestore();
    });

    it('clears cleanup interval on destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
