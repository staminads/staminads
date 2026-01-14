import { useState, useCallback, useRef, useEffect } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { api } from '../lib/api'
import type { ExploreState, ExploreConfigOutput, Message, AssistantStatus, ConversationUsage } from '../types/assistant'

const MAX_HISTORY = 20

export interface SendPromptOptions {
  generateTitle?: boolean
  currentPage?: string
  onTitle?: (title: string) => void
}

export function useAssistant(workspaceId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<AssistantStatus>('idle')
  const [usage, setUsage] = useState<ConversationUsage>({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  const abortControllerRef = useRef<AbortController | null>(null)
  const conversationHistoryRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  const onTitleRef = useRef<((title: string) => void) | undefined>(undefined)

  // Reset state when workspace changes
  useEffect(() => {
    setMessages([])
    conversationHistoryRef.current = []
    setStatus('idle')
    setUsage({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  }, [workspaceId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const sendPrompt = useCallback(async (
    prompt: string,
    currentState?: ExploreState,
    options?: SendPromptOptions,
  ) => {
    if (!prompt.trim()) return

    // Cancel any in-flight request
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Add user message (optimistic)
    const userMsgId = `user-${Date.now()}`
    const assistantMsgId = `assistant-${Date.now()}`
    const now = new Date().toISOString()

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: prompt, status: 'complete', created_at: now },
      { id: assistantMsgId, role: 'assistant', content: '', thinking: '', toolCalls: [], status: 'pending', created_at: now },
    ])

    setStatus('connecting')
    let thinkingText = ''

    // Store callback in ref to avoid stale closure
    onTitleRef.current = options?.onTitle

    try {
      // Create job
      const { job_id } = await api.assistant.chat({
        workspace_id: workspaceId,
        prompt,
        current_state: currentState,
        current_page: options?.currentPage,
        generate_title: options?.generateTitle,
        messages: conversationHistoryRef.current.slice(-MAX_HISTORY),
      })

      const token = localStorage.getItem('token')

      // Use fetch-event-source for robust SSE
      await fetchEventSource(`/api/assistant.stream/${job_id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,

        async onopen(response) {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setStatus('streaming')
        },

        onmessage(event) {
          try {
            const data = JSON.parse(event.data)

            switch (event.event) {
              case 'thinking':
                thinkingText += data.text
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, thinking: thinkingText, status: 'streaming' }
                    : m
                ))
                break

              case 'tool_call':
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, toolCalls: [...(m.toolCalls || []), { name: data.name, input: data.input }] }
                    : m
                ))
                break

              case 'config':
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, config: data as ExploreConfigOutput, status: 'complete' }
                    : m
                ))
                break

              case 'title':
                // Call the title callback via ref to avoid stale closure
                onTitleRef.current?.(data.title)
                break

              case 'usage':
                setUsage(prev => ({
                  inputTokens: prev.inputTokens + data.input_tokens,
                  outputTokens: prev.outputTokens + data.output_tokens,
                  costUsd: prev.costUsd + data.cost_usd,
                }))
                break

              case 'error':
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, status: 'error', error: data.message }
                    : m
                ))
                setStatus('error')
                break

              case 'done':
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, status: 'complete', content: thinkingText }
                    : m
                ))
                setStatus('done')
                break
            }
          } catch {
            // Ignore malformed events
          }
        },

        onerror(error) {
          if (error instanceof Error && error.name === 'AbortError') return
          throw error
        },
      })

      // Update conversation history (limit size)
      conversationHistoryRef.current = [
        ...conversationHistoryRef.current,
        { role: 'user' as const, content: prompt },
        { role: 'assistant' as const, content: thinkingText || 'Configured report' },
      ].slice(-MAX_HISTORY)

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return

      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
          : m
      ))
      setStatus('error')
    }
  }, [workspaceId])

  const clearMessages = useCallback(() => {
    setMessages([])
    conversationHistoryRef.current = []
    setStatus('idle')
    setUsage({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  }, [])

  // Load a conversation from storage
  const loadConversation = useCallback((
    storedMessages: Message[],
    storedUsage?: ConversationUsage,
  ) => {
    setMessages(storedMessages)

    // Rebuild conversation history for API
    conversationHistoryRef.current = storedMessages
      .filter(m => m.status === 'complete')
      .map(m => ({
        role: m.role,
        content: m.content || m.thinking || '',
      }))
      .slice(-MAX_HISTORY)

    setStatus('idle')
    setUsage(storedUsage || { inputTokens: 0, outputTokens: 0, costUsd: 0 })
  }, [])

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    setStatus('idle')
  }, [])

  return {
    messages,
    status,
    usage,
    isStreaming: status === 'connecting' || status === 'streaming',
    sendPrompt,
    clearMessages,
    loadConversation,
    stopStreaming,
  }
}
