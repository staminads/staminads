import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useLocation } from '@tanstack/react-router'
import { useAssistantStorage } from '../hooks/useAssistantStorage'
import { useAssistant } from '../hooks/useAssistant'
import type {
  AssistantConversation,
  Message,
  ExploreConfigOutput,
  ExploreState,
  AssistantStatus,
  ConversationUsage,
} from '../types/assistant'

type AssistantView = 'chat' | 'history'

interface AssistantContextValue {
  // Workspace
  workspaceId: string

  // UI state
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  view: AssistantView
  setView: (view: AssistantView) => void

  // Conversations (from storage)
  conversations: AssistantConversation[]
  activeConversation: AssistantConversation | undefined
  selectConversation: (id: string | null) => void
  newConversation: () => void
  deleteConversation: (id: string) => void

  // Current chat state
  messages: Message[]
  status: AssistantStatus
  usage: ConversationUsage
  isStreaming: boolean

  // Actions
  sendPrompt: (prompt: string, exploreState?: ExploreState) => void
  clearMessages: () => void
  stopStreaming: () => void

  // Config callbacks (set by pages)
  onApplyExploreConfig: ((config: ExploreConfigOutput) => void) | null
  setOnApplyExploreConfig: (cb: ((config: ExploreConfigOutput) => void) | null) => void

  // Dismissed configs (persisted per conversation)
  dismissedConfigIds: string[]
  dismissConfig: (msgId: string) => void
}

const AssistantContext = createContext<AssistantContextValue | null>(null)

interface AssistantProviderProps {
  children: ReactNode
  workspaceId: string
}

export function AssistantProvider({ children, workspaceId }: AssistantProviderProps) {
  // UI state
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<AssistantView>('chat')

  // Storage hook for persistence
  const storage = useAssistantStorage(workspaceId)

  // Chat hook for API communication
  const chat = useAssistant(workspaceId)

  // Config callback (registered by pages like explore)
  const [onApplyExploreConfig, setOnApplyExploreConfig] = useState<
    ((config: ExploreConfigOutput) => void) | null
  >(null)

  // Get current page from router
  const location = useLocation()
  const currentPage = useMemo(() => {
    if (location.pathname.includes('/explore')) return 'explore'
    if (location.pathname.includes('/live')) return 'live'
    if (location.pathname.includes('/goals')) return 'goals'
    if (location.pathname.includes('/filters')) return 'filters'
    if (location.pathname.includes('/annotations')) return 'annotations'
    if (location.pathname.includes('/settings')) return 'settings'
    return 'dashboard'
  }, [location.pathname])

  // Dismissed config IDs - derived from active conversation
  const dismissedConfigIds = useMemo(
    () => storage.activeConversation?.dismissedConfigIds || [],
    [storage.activeConversation]
  )

  // Dismiss a config (persists to storage)
  const dismissConfig = useCallback(
    (msgId: string) => {
      if (!storage.activeConversationId) return
      const current = storage.activeConversation?.dismissedConfigIds || []
      if (!current.includes(msgId)) {
        storage.updateConversation(storage.activeConversationId, {
          dismissedConfigIds: [...current, msgId],
        })
      }
    },
    [storage]
  )

  // Track last synced message to prevent infinite loops
  const lastSyncedMessageRef = useRef<string | null>(null)

  // Load active conversation into chat when storage has messages but chat doesn't
  useEffect(() => {
    if (
      storage.activeConversationId &&
      storage.activeConversation?.messages.length &&
      chat.messages.length === 0
    ) {
      chat.loadConversation(
        storage.activeConversation.messages,
        storage.activeConversation.usage
      )
      // Prevent sync effect from re-persisting already-stored messages
      const lastComplete = storage.activeConversation.messages
        .filter(m => m.status === 'complete')
        .pop()
      if (lastComplete) {
        lastSyncedMessageRef.current = lastComplete.id
      }
    }
  }, [storage.activeConversationId, storage.activeConversation, chat])

  // Sync chat messages to storage when they change
  useEffect(() => {
    if (storage.activeConversationId && chat.messages.length > 0) {
      const lastMessage = chat.messages[chat.messages.length - 1]
      // Only sync when message is complete/error AND we haven't already synced this message
      if (
        (lastMessage?.status === 'complete' || lastMessage?.status === 'error') &&
        lastMessage?.id !== lastSyncedMessageRef.current
      ) {
        lastSyncedMessageRef.current = lastMessage.id
        storage.updateConversation(storage.activeConversationId, {
          messages: chat.messages,
          usage: chat.usage,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when messages change
  }, [chat.messages, storage.activeConversationId])

  // New conversation handler
  const newConversation = useCallback(() => {
    chat.clearMessages()
    storage.createConversation()
    setView('chat')
  }, [chat, storage])

  // Select conversation handler
  const selectConversation = useCallback(
    (id: string | null) => {
      if (id === null) {
        newConversation()
        return
      }

      storage.selectConversation(id)
      setView('chat')

      // Load messages from storage into chat hook
      const conv = storage.conversations.find((c) => c.id === id)
      if (conv && conv.messages.length > 0) {
        chat.loadConversation(conv.messages, conv.usage)
        // Prevent sync effect from re-persisting already-stored messages
        const lastComplete = conv.messages.filter(m => m.status === 'complete').pop()
        if (lastComplete) {
          lastSyncedMessageRef.current = lastComplete.id
        }
      } else {
        chat.clearMessages()
        lastSyncedMessageRef.current = null
      }
    },
    [storage, chat, newConversation],
  )

  // Delete conversation handler
  const deleteConversation = useCallback(
    (id: string) => {
      const wasActive = storage.activeConversationId === id
      storage.deleteConversation(id)

      if (wasActive) {
        chat.clearMessages()
      }
    },
    [storage, chat],
  )

  // Send prompt handler - integrates chat and storage
  const sendPrompt = useCallback(
    (prompt: string, exploreState?: ExploreState) => {
      // Create conversation if none exists
      let convId = storage.activeConversationId
      if (!convId) {
        convId = storage.createConversation()
      }

      // Check if this is the first message (for title generation)
      const isFirstMessage =
        !storage.activeConversation?.messages.length &&
        chat.messages.length === 0

      // Send to chat API with title generation flag
      chat.sendPrompt(prompt, exploreState, {
        generateTitle: isFirstMessage,
        currentPage,
        onTitle: (title) => {
          storage.setTitle(title)
        },
      })
    },
    [storage, chat, currentPage],
  )

  // Clear messages handler
  const clearMessages = useCallback(() => {
    chat.clearMessages()
    if (storage.activeConversationId) {
      storage.updateConversation(storage.activeConversationId, {
        messages: [],
        title: '',  // Also clear title
      })
    }
    lastSyncedMessageRef.current = null
  }, [chat, storage])

  // Messages to display - from chat state or loaded conversation
  const displayMessages = useMemo(() => {
    // If we have active chat messages, show those
    if (chat.messages.length > 0) {
      return chat.messages
    }

    // Otherwise show messages from the active conversation in storage
    return storage.activeConversation?.messages || []
  }, [chat.messages, storage.activeConversation])

  const value = useMemo(
    (): AssistantContextValue => ({
      workspaceId,
      isOpen,
      setIsOpen,
      view,
      setView,
      conversations: storage.conversations,
      activeConversation: storage.activeConversation,
      selectConversation,
      newConversation,
      deleteConversation,
      messages: displayMessages,
      status: chat.status,
      usage: chat.usage,
      isStreaming: chat.isStreaming,
      sendPrompt,
      clearMessages,
      stopStreaming: chat.stopStreaming,
      onApplyExploreConfig,
      setOnApplyExploreConfig,
      dismissedConfigIds,
      dismissConfig,
    }),
    [
      workspaceId,
      isOpen,
      view,
      storage.conversations,
      storage.activeConversation,
      selectConversation,
      newConversation,
      deleteConversation,
      displayMessages,
      chat.status,
      chat.usage,
      chat.isStreaming,
      sendPrompt,
      clearMessages,
      chat.stopStreaming,
      onApplyExploreConfig,
      dismissedConfigIds,
      dismissConfig,
    ],
  )

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAssistantContext() {
  const context = useContext(AssistantContext)
  if (!context) {
    throw new Error('useAssistantContext must be used within AssistantProvider')
  }
  return context
}
