import type { Filter, DatePreset } from './analytics'

export type SSEEventType = 'thinking' | 'tool_call' | 'tool_result' | 'config' | 'usage' | 'error' | 'done'

export interface SSEEvent {
  type: SSEEventType
  data: unknown
  timestamp: number
}

export interface ThinkingEvent {
  type: 'thinking'
  data: { text: string }
}

export interface ToolCallEvent {
  type: 'tool_call'
  data: { name: string; input: unknown }
}

export interface ToolResultEvent {
  type: 'tool_result'
  data: { name: string; result: unknown }
}

export interface ConfigEvent {
  type: 'config'
  data: ExploreConfigOutput
}

export interface ErrorEvent {
  type: 'error'
  data: { code: string; message: string; retry_after?: number }
}

export interface DoneEvent {
  type: 'done'
  data: { message: string }
}

export interface UsageEvent {
  type: 'usage'
  data: { input_tokens: number; output_tokens: number; cost_usd: number }
}

export interface ConversationUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface ExploreConfigOutput {
  dimensions?: string[]
  filters?: Filter[]
  period?: DatePreset
  comparison?: 'previous_period' | 'previous_year' | 'none'
  minSessions?: number
  customStart?: string
  customEnd?: string
}

export interface ExploreState {
  dimensions?: string[]
  filters?: Filter[]
  period?: DatePreset
  comparison?: 'previous_period' | 'previous_year' | 'none'
  minSessions?: number
  customStart?: string
  customEnd?: string
}

export interface AssistantChatRequest {
  workspace_id: string
  prompt: string
  current_state?: ExploreState
  messages?: { role: 'user' | 'assistant'; content: string }[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: { name: string; input: unknown }[]
  config?: ExploreConfigOutput
  status: 'pending' | 'streaming' | 'complete' | 'error'
  error?: string
}

export type AssistantStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error'
