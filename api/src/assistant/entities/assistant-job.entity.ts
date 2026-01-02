import { ExploreConfigOutput } from '../dto/explore-config.dto';
import { ExploreStateDto, MessageDto } from '../dto/chat.dto';

export type AssistantJobStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * In-memory job entity for tracking AI assistant requests.
 * Enables reconnection if client connection drops.
 */
export interface AssistantJob {
  id: string;
  workspace_id: string;
  status: AssistantJobStatus;
  prompt: string;
  messages: MessageDto[];
  current_state?: ExploreStateDto;
  result?: ExploreConfigOutput;
  error?: string;
  created_at: string;
  expires_at: string;

  // Stream state for reconnection
  accumulated_text: string;
  tool_calls: Array<{
    name: string;
    input: unknown;
    result?: unknown;
  }>;
}

/**
 * Default job expiration time (5 minutes).
 */
export const JOB_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * Create a new assistant job.
 */
export function createAssistantJob(
  id: string,
  workspaceId: string,
  prompt: string,
  currentState?: ExploreStateDto,
  messages?: MessageDto[],
): AssistantJob {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JOB_EXPIRATION_MS);

  return {
    id,
    workspace_id: workspaceId,
    status: 'pending',
    prompt,
    messages: messages || [],
    current_state: currentState,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    accumulated_text: '',
    tool_calls: [],
  };
}
