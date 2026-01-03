import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { AnthropicIntegration } from '../workspaces/entities/integration.entity';
import * as crypto from '../common/crypto';
import { EventEmitter } from 'events';

// Mock crypto module
jest.mock('../common/crypto', () => ({
  decryptApiKey: jest.fn(),
}));

// Create mock stream that emits events
const createMockStream = (options: {
  textChunks?: string[];
  stopReason?: 'end_turn' | 'tool_use';
  toolUseBlocks?: Array<{ id: string; name: string; input: unknown }>;
  usage?: { input_tokens: number; output_tokens: number };
}) => {
  const emitter = new EventEmitter();
  const stream = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
      return stream;
    },
    finalMessage: jest.fn().mockImplementation(async () => {
      // Emit text events
      if (options.textChunks) {
        for (const chunk of options.textChunks) {
          emitter.emit('text', chunk);
        }
      }

      const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];

      // Add text blocks if we have text
      if (options.textChunks?.length) {
        content.push({ type: 'text', text: options.textChunks.join('') });
      }

      // Add tool use blocks if using tools
      if (options.stopReason === 'tool_use' && options.toolUseBlocks) {
        for (const tool of options.toolUseBlocks) {
          content.push({
            type: 'tool_use',
            id: tool.id,
            name: tool.name,
            input: tool.input,
          });
        }
      }

      return {
        stop_reason: options.stopReason || 'end_turn',
        content,
        usage: options.usage || { input_tokens: 100, output_tokens: 50 },
      };
    }),
  };
  return stream;
};

// Mock Anthropic SDK
const mockStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        stream: mockStream,
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
    status: 'active',
    created_at: '2025-01-01 00:00:00',
    updated_at: '2025-01-01 00:00:00',
    settings: {
      timescore_reference: 180,
      bounce_threshold: 10,
      custom_dimensions: {},
      filters: [],
      integrations: [mockIntegration],
      geo_enabled: true,
      geo_store_city: true,
      geo_store_region: true,
      geo_coordinates_precision: 2,
    },
  };

  const mockWorkspaceNoIntegration: Workspace = {
    ...mockWorkspace,
    id: 'ws-no-int',
    settings: { ...mockWorkspace.settings, integrations: [] },
  };

  const mockWorkspaceDisabledIntegration: Workspace = {
    ...mockWorkspace,
    id: 'ws-disabled',
    settings: { ...mockWorkspace.settings, integrations: [{ ...mockIntegration, enabled: false }] },
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
        current_state: { dimensions: ['device'] },
        messages: [{ role: 'user', content: 'Previous message' }],
      });

      const job = service.getJob(result.job_id);
      expect(job).toBeDefined();
      expect(job!.workspace_id).toBe('ws-1');
      expect(job!.prompt).toBe('Test prompt');
      expect(job!.current_state).toEqual({ dimensions: ['device'] });
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

    it('cleanup removes expired jobs', async () => {
      jest.useFakeTimers();

      workspacesService.get.mockResolvedValue(mockWorkspace);

      // Create a job
      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      // Verify job exists
      expect(service.getJob(job_id)).toBeDefined();

      // Manually expire the job
      const job = service.getJob(job_id);
      job!.expires_at = new Date(Date.now() - 1000).toISOString();

      // Start cleanup interval
      service.onModuleInit();

      // Advance time to trigger cleanup
      jest.advanceTimersByTime(60 * 1000);

      // Job should be cleaned up
      expect(service.getJob(job_id)).toBeUndefined();

      // Clean up
      service.onModuleDestroy();
      jest.useRealTimers();
    });
  });

  describe('processJob (streaming)', () => {
    let mockRes: {
      write: jest.Mock;
      end: jest.Mock;
    };

    beforeEach(() => {
      mockRes = {
        write: jest.fn(),
        end: jest.fn(),
      };
      mockStream.mockReset();
      (crypto.decryptApiKey as jest.Mock).mockReturnValue('decrypted-api-key');
    });

    it('throws error when ENCRYPTION_KEY not configured', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue(undefined);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('ENCRYPTION_KEY not configured'),
      );
    });

    it('streams text response to client', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');
      mockStream.mockReturnValue(
        createMockStream({
          textChunks: ['Hello', ' world'],
          stopReason: 'end_turn',
        }),
      );

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      // Should have written thinking events
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: thinking'),
      );
      // Should have written usage event
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: usage'),
      );
      // Should end with done
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: done'),
      );
    });

    it('handles tool use and executes tools', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');

      // First call: tool use, second call: end_turn
      mockStream
        .mockReturnValueOnce(
          createMockStream({
            textChunks: ['Let me query the data...'],
            stopReason: 'tool_use',
            toolUseBlocks: [
              {
                id: 'tool-1',
                name: 'configure_explore',
                input: {
                  metrics: ['sessions'],
                  dimensions: ['device'],
                },
              },
            ],
          }),
        );

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Show sessions by device',
      });

      await service.streamJob(job_id, mockRes as any);

      // Should have written tool_call event
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: tool_call'),
      );
      // Should have written tool_result event (configure_explore returns config)
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: tool_result'),
      );
    });

    it('handles configure_explore tool and completes job', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');

      mockStream.mockReturnValue(
        createMockStream({
          textChunks: ['Configuring...'],
          stopReason: 'tool_use',
          toolUseBlocks: [
            {
              id: 'tool-1',
              name: 'configure_explore',
              input: {
                metrics: ['sessions'],
                dimensions: ['device'],
              },
            },
          ],
        }),
      );

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Show sessions by device',
      });

      await service.streamJob(job_id, mockRes as any);

      // Should have written config event
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('event: config'),
      );

      // Job should be marked as completed
      const job = service.getJob(job_id);
      expect(job?.status).toBe('completed');
    });

    it('handles tool execution errors gracefully', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');
      analyticsService.query.mockRejectedValue(new Error('Query failed'));

      // First call: tool use with error, second call: end_turn
      mockStream
        .mockReturnValueOnce(
          createMockStream({
            textChunks: ['Querying...'],
            stopReason: 'tool_use',
            toolUseBlocks: [
              {
                id: 'tool-1',
                name: 'query_analytics',
                input: { metrics: ['sessions'] },
              },
            ],
          }),
        )
        .mockReturnValueOnce(
          createMockStream({
            textChunks: ['Error occurred...'],
            stopReason: 'end_turn',
          }),
        );

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      // Should still complete without throwing
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('handles stream creation error', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');
      mockStream.mockImplementation(() => {
        throw new Error('API error');
      });

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('STREAM_ERROR'),
      );
    });

    it('handles finalMessage error', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');

      const errorStream = {
        on: jest.fn().mockReturnThis(),
        finalMessage: jest.fn().mockRejectedValue(new Error('Stream error')),
      };
      mockStream.mockReturnValue(errorStream);

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('STREAM_ERROR'),
      );
    });

    it('calculates and sends usage statistics', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');
      mockStream.mockReturnValue(
        createMockStream({
          textChunks: ['Response'],
          stopReason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 200 },
        }),
      );

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      // Should have written usage event with correct tokens
      const usageCall = mockRes.write.mock.calls.find((call) =>
        call[0].includes('event: usage'),
      );
      expect(usageCall).toBeDefined();
      expect(usageCall[0]).toContain('500'); // input tokens
      expect(usageCall[0]).toContain('200'); // output tokens
    });

    it('marks job as completed after successful stream', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');
      mockStream.mockReturnValue(
        createMockStream({
          textChunks: ['Done'],
          stopReason: 'end_turn',
        }),
      );

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      const job = service.getJob(job_id);
      expect(job?.status).toBe('completed');
    });

    it('marks job as error on stream failure', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);
      configService.get.mockReturnValue('test-encryption-key');
      mockStream.mockImplementation(() => {
        throw new Error('Fatal error');
      });

      const { job_id } = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      await service.streamJob(job_id, mockRes as any);

      const job = service.getJob(job_id);
      expect(job?.status).toBe('error');
      expect(job?.error).toContain('Fatal error');
    });
  });

  describe('getAnthropicIntegration', () => {
    it('returns null for workspace with no integrations', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspaceNoIntegration);

      await expect(
        service.createJob({
          workspace_id: 'ws-no-int',
          prompt: 'Test',
        }),
      ).rejects.toThrow('Anthropic integration not configured');
    });

    it('returns null for workspace with disabled integration', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspaceDisabledIntegration);

      await expect(
        service.createJob({
          workspace_id: 'ws-disabled',
          prompt: 'Test',
        }),
      ).rejects.toThrow('Anthropic integration not configured');
    });

    it('returns integration when enabled', async () => {
      workspacesService.get.mockResolvedValue(mockWorkspace);

      const result = await service.createJob({
        workspace_id: 'ws-1',
        prompt: 'Test',
      });

      expect(result.job_id).toBeDefined();
    });
  });
});
