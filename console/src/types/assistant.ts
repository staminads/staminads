import type { Filter, MetricFilter, DatePreset } from './analytics'

export type SSEEventType = 'thinking' | 'tool_call' | 'tool_result' | 'config' | 'title' | 'usage' | 'error' | 'done'

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
  data: { id: string; name: string; input: unknown }
}

export interface ToolResultEvent {
  type: 'tool_result'
  data: { id: string; name: string; result: unknown }
}

/**
 * Timeline block types for interleaved chain-of-thought rendering.
 */
export type TimelineBlock = ThinkingBlock | ToolCallBlock

export interface ThinkingBlock {
  type: 'thinking'
  id: string
  text: string
}

export interface ToolCallBlock {
  type: 'tool_call'
  id: string
  name: string
  input: unknown
  status: 'pending' | 'complete' | 'error'
  result?: unknown
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

export interface TitleEvent {
  type: 'title'
  data: { title: string }
}

export interface ConversationUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface ExploreConfigOutput {
  dimensions?: string[]
  filters?: Filter[]
  metricFilters?: MetricFilter[]
  period?: DatePreset
  comparison?: 'previous_period' | 'previous_year' | 'none'
  minSessions?: number
  customStart?: string
  customEnd?: string
}

export interface ExploreState {
  dimensions?: string[]
  filters?: Filter[]
  metricFilters?: MetricFilter[]
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
  current_page?: string
  generate_title?: boolean
  messages?: { role: 'user' | 'assistant'; content: string }[]
}

/**
 * A conversation stored in localStorage.
 */
export interface AssistantConversation {
  id: string
  title: string
  messages: Message[]
  usage?: ConversationUsage
  dismissedConfigIds?: string[]
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timeline?: TimelineBlock[]
  // Legacy fields kept for backward compatibility with stored conversations
  thinking?: string
  toolCalls?: { name: string; input: unknown }[]
  config?: ExploreConfigOutput
  status: 'pending' | 'streaming' | 'complete' | 'error'
  error?: string
  created_at?: string
}

export type AssistantStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error'
