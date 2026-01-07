import {
  Injectable,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { AnthropicIntegration } from '../workspaces/entities/integration.entity';
import { decryptApiKey } from '../common/crypto';
import { ChatRequestDto, ChatJobResponse } from './dto/chat.dto';
import { ExploreConfigOutput } from './dto/explore-config.dto';
import {
  AssistantJob,
  createAssistantJob,
} from './entities/assistant-job.entity';
import {
  ASSISTANT_TOOLS,
  STRICT_ASSISTANT_TOOLS,
  ToolName,
} from './tools/tool-definitions';
import { ToolExecutor } from './tools/tool-executor';
import { buildSystemPrompt } from './lib/system-prompt';
import { checkRateLimits, updateUsage } from './lib/rate-limiter';
import {
  formatSSE,
  thinkingEvent,
  toolCallEvent,
  toolResultEvent,
  configEvent,
  usageEvent,
  errorEvent,
  doneEvent,
} from './lib/sse-formatter';
import {
  calculateCost,
  supportsStructuredOutputs,
} from './constants/model-pricing';

/**
 * Maximum streaming time (2 minutes).
 */
const MAX_STREAM_DURATION_MS = 2 * 60 * 1000;

/**
 * In-memory job store.
 */
const jobStore = new Map<string, AssistantJob>();

/**
 * Cleanup interval (1 minute).
 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    // Start periodic cleanup of expired jobs
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, job] of jobStore.entries()) {
        if (new Date(job.expires_at).getTime() < now) {
          jobStore.delete(id);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    // Clear the cleanup interval to allow process to exit
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a new chat job.
   */
  async createJob(dto: ChatRequestDto): Promise<ChatJobResponse> {
    // Get workspace and validate integration
    const workspace = await this.workspacesService.get(dto.workspace_id);
    const integration = this.getAnthropicIntegration(workspace);

    if (!integration) {
      throw new BadRequestException(
        'Anthropic integration not configured for this workspace. Add an API key in settings.',
      );
    }

    // Check rate limits
    checkRateLimits(dto.workspace_id, integration);

    // Create job
    const jobId = randomUUID();
    const job = createAssistantJob(
      jobId,
      dto.workspace_id,
      dto.prompt,
      dto.current_state,
      dto.messages,
    );

    jobStore.set(jobId, job);

    return { job_id: jobId };
  }

  /**
   * Stream job results via SSE.
   */
  async streamJob(jobId: string, res: Response): Promise<void> {
    const job = jobStore.get(jobId);

    if (!job) {
      res.write(
        formatSSE(errorEvent('JOB_NOT_FOUND', `Job ${jobId} not found`)),
      );
      res.write(formatSSE(doneEvent()));
      res.end();
      return;
    }

    // Check if job expired
    if (new Date(job.expires_at).getTime() < Date.now()) {
      jobStore.delete(jobId);
      res.write(formatSSE(errorEvent('JOB_EXPIRED', 'Job has expired')));
      res.write(formatSSE(doneEvent()));
      res.end();
      return;
    }

    // If job already completed or errored, send result
    if (job.status === 'completed' && job.result) {
      res.write(formatSSE(configEvent(job.result)));
      res.write(formatSSE(doneEvent()));
      res.end();
      return;
    }

    if (job.status === 'error' && job.error) {
      res.write(formatSSE(errorEvent('STREAM_ERROR', job.error)));
      res.write(formatSSE(doneEvent()));
      res.end();
      return;
    }

    // If job already running, just stream accumulated text and wait
    if (job.status === 'running') {
      if (job.accumulated_text) {
        res.write(formatSSE(thinkingEvent(job.accumulated_text)));
      }
      // TODO: Implement proper reconnection by waiting for job completion
      res.write(formatSSE(doneEvent()));
      res.end();
      return;
    }

    // Start processing
    job.status = 'running';
    jobStore.set(jobId, job);

    try {
      await this.processJob(job, res);
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      jobStore.set(jobId, job);
      res.write(formatSSE(errorEvent('STREAM_ERROR', job.error)));
    } finally {
      res.write(formatSSE(doneEvent()));
      res.end();
    }
  }

  /**
   * Process a job with Anthropic streaming.
   */
  private async processJob(job: AssistantJob, res: Response): Promise<void> {
    const workspace = await this.workspacesService.get(job.workspace_id);
    const integration = this.getAnthropicIntegration(workspace);

    if (!integration) {
      throw new BadRequestException('Integration not found');
    }

    // Decrypt API key
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY')!;

    const apiKey = decryptApiKey(
      integration.settings.api_key_encrypted,
      encryptionKey,
      job.workspace_id,
    );

    // Check if model supports structured outputs
    const useStructuredOutputs = supportsStructuredOutputs(
      integration.settings.model,
    );
    console.log(
      `[Assistant] Model: ${integration.settings.model}, Structured outputs: ${useStructuredOutputs}`,
    );

    // Create Anthropic client with beta header for structured outputs
    const client = new Anthropic({
      apiKey,
      ...(useStructuredOutputs && {
        defaultHeaders: {
          'anthropic-beta': 'structured-outputs-2025-11-13',
        },
      }),
    });

    // Create tool executor
    const toolExecutor = new ToolExecutor(
      this.analyticsService,
      job.workspace_id,
    );

    // Build initial messages
    const messages: Anthropic.MessageParam[] = [
      ...job.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user' as const, content: job.prompt },
    ];

    const systemPrompt = buildSystemPrompt(workspace, job.current_state);
    const startTime = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Streaming loop with tool handling
    let continueLoop = true;

    while (continueLoop) {
      // Check timeout
      if (Date.now() - startTime > MAX_STREAM_DURATION_MS) {
        throw new BadRequestException('Request timeout');
      }

      // Create stream
      let stream;
      try {
        stream = client.messages.stream({
          model: integration.settings.model,
          max_tokens: integration.settings.max_tokens,
          system: systemPrompt,
          messages,
          tools: useStructuredOutputs
            ? STRICT_ASSISTANT_TOOLS
            : ASSISTANT_TOOLS,
        });
      } catch (streamError) {
        console.error('Failed to create Anthropic stream:', streamError);
        throw streamError;
      }

      // Listen for text events
      stream.on('text', (text) => {
        job.accumulated_text += text;
        jobStore.set(job.id, job);
        res.write(formatSSE(thinkingEvent(text)));
      });

      // Wait for completion
      let message;
      try {
        message = await stream.finalMessage();
      } catch (finalError) {
        console.error('Anthropic stream error:', finalError);
        throw finalError;
      }
      totalInputTokens += message.usage.input_tokens;
      totalOutputTokens += message.usage.output_tokens;

      // Check for tool use
      if (message.stop_reason === 'tool_use') {
        const toolUseBlocks = message.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          // Emit tool call event
          res.write(formatSSE(toolCallEvent(toolUse.name, toolUse.input)));

          try {
            // Execute tool
            const result = await toolExecutor.execute(
              toolUse.name as ToolName,
              toolUse.input,
            );

            // Track tool call
            job.tool_calls.push({
              name: toolUse.name,
              input: toolUse.input,
              result,
            });
            jobStore.set(job.id, job);

            // Emit tool result event
            res.write(formatSSE(toolResultEvent(toolUse.name, result)));

            // Check if this is configure_explore (final action)
            if (
              toolUse.name === 'configure_explore' &&
              result &&
              typeof result === 'object' &&
              'config' in result
            ) {
              const configResult = result as { config: ExploreConfigOutput };
              job.result = configResult.config;
              job.status = 'completed';
              jobStore.set(job.id, job);
              res.write(formatSSE(configEvent(configResult.config)));
              continueLoop = false;
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Tool execution failed';

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: errorMessage }),
              is_error: true,
            });
          }
        }

        // If we got configure_explore, stop loop
        if (!continueLoop) {
          break;
        }

        // Add assistant message and tool results to continue conversation
        messages.push({ role: 'assistant', content: message.content });
        messages.push({ role: 'user', content: toolResults });
      } else {
        // Model finished without tool use (end_turn)
        continueLoop = false;
      }
    }

    // Calculate and send usage
    const totalTokens = totalInputTokens + totalOutputTokens;
    const costUsd = calculateCost(
      integration.settings.model,
      totalInputTokens,
      totalOutputTokens,
    );
    res.write(
      formatSSE(usageEvent(totalInputTokens, totalOutputTokens, costUsd)),
    );

    // Update in-memory usage tracking
    updateUsage(job.workspace_id, integration.id, totalTokens);

    // Mark job complete if not already
    if (job.status !== 'completed') {
      job.status = 'completed';
      jobStore.set(job.id, job);
    }
  }

  /**
   * Get Anthropic integration from workspace.
   */
  private getAnthropicIntegration(
    workspace: Workspace,
  ): AnthropicIntegration | null {
    const integrations = workspace.settings.integrations || [];
    return (
      (integrations.find(
        (i) => i.type === 'anthropic' && i.enabled,
      ) as AnthropicIntegration) || null
    );
  }

  /**
   * Get job by ID.
   */
  getJob(jobId: string): AssistantJob | undefined {
    return jobStore.get(jobId);
  }
}
