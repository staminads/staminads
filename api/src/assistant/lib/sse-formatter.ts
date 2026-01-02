/**
 * SSE event types for AI assistant streaming.
 */
export type SSEEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'config'
  | 'usage'
  | 'error'
  | 'done';

/**
 * Error codes for SSE error events.
 */
export type SSEErrorCode =
  | 'RATE_LIMIT'
  | 'INVALID_API_KEY'
  | 'QUERY_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'STREAM_ERROR'
  | 'JOB_NOT_FOUND'
  | 'JOB_EXPIRED';

/**
 * SSE event structure.
 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: number;
}

/**
 * Format an SSE event for streaming.
 */
export function formatSSE(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Create an SSE event.
 */
export function createSSEEvent(type: SSEEventType, data: unknown): SSEEvent {
  return {
    type,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create a thinking event.
 */
export function thinkingEvent(text: string): SSEEvent {
  return createSSEEvent('thinking', { text });
}

/**
 * Create a tool call event.
 */
export function toolCallEvent(name: string, input: unknown): SSEEvent {
  return createSSEEvent('tool_call', { name, input });
}

/**
 * Create a tool result event.
 */
export function toolResultEvent(name: string, result: unknown): SSEEvent {
  return createSSEEvent('tool_result', { name, result });
}

/**
 * Create a config event (final explore configuration).
 */
export function configEvent(config: unknown): SSEEvent {
  return createSSEEvent('config', config);
}

/**
 * Create an error event.
 */
export function errorEvent(
  code: SSEErrorCode,
  message: string,
  retryAfter?: number,
): SSEEvent {
  return createSSEEvent('error', { code, message, retry_after: retryAfter });
}

/**
 * Create a done event.
 */
export function doneEvent(): SSEEvent {
  return createSSEEvent('done', { message: 'Stream complete' });
}

/**
 * Create a usage event with token counts and cost.
 */
export function usageEvent(
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): SSEEvent {
  return createSSEEvent('usage', {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  });
}
