import { useState, useCallback } from 'react'
import type { AssistantConversation, Message } from '../types/assistant'

const STORAGE_KEY_PREFIX = 'staminads:assistant:'
const MAX_CONVERSATIONS = 50
const MAX_MESSAGES = 100

interface StoredData {
  conversations: AssistantConversation[]
  activeConversationId: string | null
}

/**
 * Load data from localStorage synchronously
 */
function loadFromStorage(storageKey: string): StoredData {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const data = JSON.parse(stored) as StoredData
      return {
        conversations: data.conversations || [],
        activeConversationId: data.activeConversationId || null,
      }
    }
  } catch {
    // Ignore parse errors
  }
  return { conversations: [], activeConversationId: null }
}

/**
 * Hook for managing assistant conversations in localStorage.
 */
export function useAssistantStorage(workspaceId: string) {
  const storageKey = `${STORAGE_KEY_PREFIX}${workspaceId}`

  // Initialize state from localStorage synchronously
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    () => loadFromStorage(storageKey).conversations,
  )
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => loadFromStorage(storageKey).activeConversationId,
  )

  // Persist to localStorage
  const persist = useCallback(
    (convs: AssistantConversation[], activeId: string | null) => {
      // Enforce max conversations
      const limited = convs
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, MAX_CONVERSATIONS)

      // Enforce max messages per conversation
      const trimmed = limited.map((conv) => ({
        ...conv,
        messages: conv.messages.slice(-MAX_MESSAGES),
      }))

      const data: StoredData = {
        conversations: trimmed,
        activeConversationId: activeId,
      }

      try {
        localStorage.setItem(storageKey, JSON.stringify(data))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          // Remove oldest half of conversations and retry
          const reduced = trimmed.slice(0, Math.ceil(trimmed.length / 2))
          const reducedData: StoredData = {
            conversations: reduced,
            activeConversationId: reduced.find(c => c.id === activeId) ? activeId : reduced[0]?.id || null,
          }
          try {
            localStorage.setItem(storageKey, JSON.stringify(reducedData))
          } catch {
            // Last resort: clear all
            localStorage.removeItem(storageKey)
          }
        }
      }
    },
    [storageKey],
  )

  // Create new conversation
  const createConversation = useCallback((): string => {
    const now = new Date().toISOString()
    const newConv: AssistantConversation = {
      id: `conv-${Date.now()}`,
      title: '',
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      created_at: now,
      updated_at: now,
    }

    const updated = [newConv, ...conversations]
    setConversations(updated)
    setActiveConversationId(newConv.id)
    persist(updated, newConv.id)

    return newConv.id
  }, [conversations, persist])

  // Update conversation (messages, title, etc.)
  const updateConversation = useCallback(
    (id: string, updates: Partial<AssistantConversation>) => {
      const updated = conversations.map((c) =>
        c.id === id
          ? { ...c, ...updates, updated_at: new Date().toISOString() }
          : c,
      )
      setConversations(updated)
      persist(updated, activeConversationId)
    },
    [conversations, activeConversationId, persist],
  )

  // Delete conversation
  const deleteConversation = useCallback(
    (id: string) => {
      const updated = conversations.filter((c) => c.id !== id)
      const newActiveId =
        activeConversationId === id
          ? updated[0]?.id || null
          : activeConversationId

      setConversations(updated)
      setActiveConversationId(newActiveId)
      persist(updated, newActiveId)
    },
    [conversations, activeConversationId, persist],
  )

  // Set active conversation
  const selectConversation = useCallback(
    (id: string | null) => {
      setActiveConversationId(id)
      persist(conversations, id)
    },
    [conversations, persist],
  )

  // Get active conversation
  const activeConversation = conversations.find((c) => c.id === activeConversationId)

  // Add message to active conversation
  const addMessage = useCallback(
    (message: Message) => {
      if (!activeConversationId) return

      const updated = conversations.map((c) =>
        c.id === activeConversationId
          ? {
              ...c,
              messages: [...c.messages, message],
              updated_at: new Date().toISOString(),
            }
          : c,
      )
      setConversations(updated)
      persist(updated, activeConversationId)
    },
    [conversations, activeConversationId, persist],
  )

  // Update last message in active conversation
  const updateLastMessage = useCallback(
    (updates: Partial<Message>) => {
      if (!activeConversationId) return

      const updated = conversations.map((c) => {
        if (c.id !== activeConversationId) return c

        const messages = [...c.messages]
        if (messages.length > 0) {
          messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            ...updates,
          }
        }

        return { ...c, messages, updated_at: new Date().toISOString() }
      })

      setConversations(updated)
      persist(updated, activeConversationId)
    },
    [conversations, activeConversationId, persist],
  )

  // Set title for active conversation
  const setTitle = useCallback(
    (title: string) => {
      if (!activeConversationId) return
      updateConversation(activeConversationId, { title })
    },
    [activeConversationId, updateConversation],
  )

  // Clear all conversations
  const clearAll = useCallback(() => {
    setConversations([])
    setActiveConversationId(null)
    localStorage.removeItem(storageKey)
  }, [storageKey])

  return {
    conversations,
    activeConversationId,
    activeConversation,
    createConversation,
    updateConversation,
    deleteConversation,
    selectConversation,
    addMessage,
    updateLastMessage,
    setTitle,
    clearAll,
  }
}
