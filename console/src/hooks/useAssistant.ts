import { useState, useCallback, useRef, useEffect } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { api } from '../lib/api'
import type { ExploreState, ExploreConfigOutput, Message, AssistantStatus, ConversationUsage } from '../types/assistant'

const MAX_HISTORY = 20

export function useAssistant(workspaceId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<AssistantStatus>('idle')
  const [usage, setUsage] = useState<ConversationUsage>({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  const abortControllerRef = useRef<AbortController | null>(null)
  const conversationHistoryRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])

  // Session storage keys include workspace ID
  const sessionKeyMessages = `assistant_messages_${workspaceId}`
  const sessionKeyHistory = `assistant_history_${workspaceId}`

  // Restore from sessionStorage on mount or workspace change
  useEffect(() => {
    const savedMessages = sessionStorage.getItem(sessionKeyMessages)
    const savedHistory = sessionStorage.getItem(sessionKeyHistory)
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages) as Message[]
        // Filter out error messages so user can retry after configuring integration
        setMessages(parsed.filter(m => m.status !== 'error'))
      } catch {
        // Ignore invalid JSON
      }
    } else {
      setMessages([])
    }
    if (savedHistory) {
      try {
        conversationHistoryRef.current = JSON.parse(savedHistory)
      } catch {
        conversationHistoryRef.current = []
      }
    } else {
      conversationHistoryRef.current = []
    }
    setStatus('idle')
    setUsage({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  }, [workspaceId, sessionKeyMessages, sessionKeyHistory])

  // Persist to sessionStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem(sessionKeyMessages, JSON.stringify(messages))
      sessionStorage.setItem(sessionKeyHistory, JSON.stringify(conversationHistoryRef.current))
    }
  }, [messages, sessionKeyMessages, sessionKeyHistory])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const sendPrompt = useCallback(async (
    prompt: string,
    currentState?: ExploreState,
  ) => {
    if (!prompt.trim()) return

    // Cancel any in-flight request
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Add user message (optimistic)
    const userMsgId = `user-${Date.now()}`
    const assistantMsgId = `assistant-${Date.now()}`

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: prompt, status: 'complete' },
      { id: assistantMsgId, role: 'assistant', content: '', thinking: '', toolCalls: [], status: 'pending' },
    ])

    setStatus('connecting')
    let thinkingText = ''

    try {
      // Create job
      const { job_id } = await api.assistant.chat({
        workspace_id: workspaceId,
        prompt,
        current_state: currentState,
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
    sessionStorage.removeItem(sessionKeyMessages)
    sessionStorage.removeItem(sessionKeyHistory)
    setStatus('idle')
    setUsage({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  }, [sessionKeyMessages, sessionKeyHistory])

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
    stopStreaming,
  }
}
