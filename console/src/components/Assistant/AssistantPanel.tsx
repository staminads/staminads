import { useRef, useEffect, useState, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, Button, Tag, Drawer, Spin, Typography, Space, Empty, Tooltip, Popover } from 'antd'
import {
  CheckOutlined,
  PlusOutlined,
  HistoryOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import { Bubble, Sender } from '@ant-design/x'
import { XMarkdown } from '@ant-design/x-markdown'
import '@ant-design/x-markdown/themes/light.css'
import type { SenderRef } from '@ant-design/x/es/sender/interface'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useAssistantContext } from '../../contexts/AssistantContext'
import type { ExploreConfigOutput, AssistantConversation, TimelineBlock, ToolCallBlock } from '../../types/assistant'

dayjs.extend(relativeTime)

const QUICK_PROMPTS = [
  'Show me UTM campaigns by device for last week',
  'Landing pages with bounce rate over 50%',
  'Compare channels this month vs last month',
  'Traffic by day of week and hour',
]

// Hook to detect mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

// Config preview component
function ConfigPreview({
  config,
  onApply,
  onDismiss,
}: {
  config: ExploreConfigOutput
  onApply: () => void
  onDismiss: () => void
}) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mt-2">
      <div className="text-sm font-medium mb-2">Suggested configuration:</div>
      <ul className="text-sm space-y-1 mb-3">
        {config.dimensions && (
          <li>
            <span className="text-gray-500">Dimensions:</span> {config.dimensions.join(', ')}
          </li>
        )}
        {config.period && (
          <li>
            <span className="text-gray-500">Period:</span> {config.period}
          </li>
        )}
        {config.filters && config.filters.length > 0 && (
          <li>
            <span className="text-gray-500">Filters:</span> {config.filters.length} filter(s)
          </li>
        )}
        {config.comparison && config.comparison !== 'none' && (
          <li>
            <span className="text-gray-500">Comparison:</span> {config.comparison}
          </li>
        )}
      </ul>
      <Space>
        <Button type="primary" size="small" icon={<CheckOutlined />} onClick={onApply}>
          View Report
        </Button>
        <Button size="small" onClick={onDismiss}>
          Dismiss
        </Button>
      </Space>
    </div>
  )
}

// Tool call block with Popover showing input/result
function ToolCallBlockRenderer({ block }: { block: ToolCallBlock }) {
  const statusIcon =
    block.status === 'pending' ? (
      <LoadingOutlined spin />
    ) : (
      <CheckCircleOutlined style={{ color: '#52c41a' }} />
    )

  const popoverContent = (
    <div style={{ maxWidth: 400, maxHeight: 300, overflow: 'auto' }}>
      <div className="mb-2">
        <strong>Input:</strong>
        <pre className="bg-gray-50 p-2 rounded text-xs mt-1 overflow-x-auto">
          {JSON.stringify(block.input, null, 2)}
        </pre>
      </div>
      {block.result !== undefined && (
        <div>
          <strong>Result:</strong>
          <pre className="bg-gray-50 p-2 rounded text-xs mt-1 overflow-x-auto">
            {JSON.stringify(block.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )

  return (
    <Popover content={popoverContent} title={block.name} trigger="click" placement="left">
      <Tag color="blue" className="cursor-pointer hover:opacity-80 transition-opacity" icon={statusIcon}>
        {block.name}
      </Tag>
    </Popover>
  )
}

// Interleaved timeline renderer
function AssistantTimeline({ timeline }: { timeline: TimelineBlock[] }) {
  return (
    <div className="space-y-2">
      {timeline.map((block) =>
        block.type === 'thinking' ? (
          <Typography key={block.id} className="text-sm text-gray-600">
            <XMarkdown content={block.text} />
          </Typography>
        ) : (
          <ToolCallBlockRenderer key={block.id} block={block} />
        )
      )}
    </div>
  )
}

// Conversation list item
function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: AssistantConversation
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const firstMessage = conversation.messages.find((m) => m.role === 'user')

  return (
    <div
      className={`p-3 rounded-md cursor-pointer group transition-colors ${
        isActive ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {conversation.title || 'New Conversation'}
          </div>
          {firstMessage && (
            <div className="text-xs text-gray-500 truncate mt-1">
              "{firstMessage.content.substring(0, 50)}..."
            </div>
          )}
          <div className="text-xs text-gray-400 mt-1">
            {dayjs(conversation.updated_at).fromNow()}
          </div>
        </div>
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        />
      </div>
    </div>
  )
}

// History view component
function HistoryView() {
  const { conversations, activeConversation, selectConversation, newConversation, deleteConversation } =
    useAssistantContext()

  // Group conversations by date
  const grouped = useMemo(() => {
    const today = dayjs().startOf('day')
    const yesterday = today.subtract(1, 'day')

    const groups: { label: string; conversations: AssistantConversation[] }[] = []
    const todayConvs: AssistantConversation[] = []
    const yesterdayConvs: AssistantConversation[] = []
    const olderConvs: AssistantConversation[] = []

    conversations.forEach((conv) => {
      const convDate = dayjs(conv.updated_at).startOf('day')
      if (convDate.isSame(today)) {
        todayConvs.push(conv)
      } else if (convDate.isSame(yesterday)) {
        yesterdayConvs.push(conv)
      } else {
        olderConvs.push(conv)
      }
    })

    if (todayConvs.length > 0) groups.push({ label: 'Today', conversations: todayConvs })
    if (yesterdayConvs.length > 0) groups.push({ label: 'Yesterday', conversations: yesterdayConvs })
    if (olderConvs.length > 0) groups.push({ label: 'Older', conversations: olderConvs })

    return groups
  }, [conversations])

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Empty
          description="No conversations yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={newConversation}>
            Start a Conversation
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="text-xs font-medium text-gray-500 uppercase mb-2">{group.label}</div>
          <div className="space-y-2">
            {group.conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversation?.id}
                onSelect={() => selectConversation(conv.id)}
                onDelete={() => deleteConversation(conv.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AssistantPanel() {
  const {
    workspaceId,
    isOpen,
    setIsOpen,
    view,
    setView,
    messages,
    status,
    usage,
    isStreaming,
    activeConversation,
    sendPrompt,
    clearMessages,
    newConversation,
    dismissedConfigIds,
    dismissConfig,
  } = useAssistantContext()

  const navigate = useNavigate()

  const inputRef = useRef<SenderRef>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const dismissedConfigs = useMemo(() => new Set(dismissedConfigIds), [dismissedConfigIds])
  const [inputValue, setInputValue] = useState('')

  // Focus input on mount
  useEffect(() => {
    if (isOpen && view === 'chat') {
      const timer = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen, view])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Keyboard navigation (Escape to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setIsOpen])

  const handleSend = (text: string) => {
    if (text.trim() && !isStreaming) {
      sendPrompt(text.trim())
      setInputValue('')
    }
  }

  const handleApplyConfig = (_msgId: string, config: ExploreConfigOutput) => {
    setIsOpen(false)

    // Build search params for URL (same format as useExploreParams.setAll)
    const search: Record<string, string | undefined> = {}
    if (config.dimensions?.length) {
      search.dimensions = config.dimensions.join(',')
    }
    if (config.filters?.length) {
      search.filters = JSON.stringify(config.filters)
    }
    if (config.period) {
      search.period = config.period
    }
    if (config.comparison) {
      search.comparison = config.comparison
    }
    if (config.minSessions && config.minSessions > 1) {
      search.minSessions = String(config.minSessions)
    }
    if (config.customStart && config.customEnd) {
      search.period = 'custom'
      search.customStart = config.customStart
      search.customEnd = config.customEnd
    }

    navigate({
      to: '/workspaces/$workspaceId/explore',
      params: { workspaceId },
      search,
    })
  }

  const handleDismissConfig = (msgId: string) => {
    dismissConfig(msgId)
  }

  const handleNewConversation = () => {
    newConversation()
    setView('chat')
  }

  // Header content based on view
  const title =
    view === 'chat' ? (
      <div className="flex items-center gap-2">
        <Button
          type="text"
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => setView('history')}
        />
        <span className="truncate max-w-40">
          {activeConversation?.title || 'New Chat'}
        </span>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={() => setView('chat')}
        />
        <span>Conversations</span>
      </div>
    )

  const extra =
    view === 'chat' ? (
      messages.length > 0 ? (
        <Button type="link" size="small" onClick={clearMessages} aria-label="Reset conversation">
          Reset
        </Button>
      ) : null
    ) : (
      <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleNewConversation}>
        New
      </Button>
    )

  // Chat content
  const chatContent = (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3"
        role="log"
        aria-live="polite"
        aria-label="Assistant conversation"
      >
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">Ask me to create a report!</p>
            <div className="flex flex-wrap gap-x-3 gap-y-4 justify-center">
              {QUICK_PROMPTS.map((prompt, i) => (
                <div
                  key={i}
                  className="cursor-pointer transition-all border border-gray-300 rounded-md bg-gray-50 hover:bg-white"
                  style={{ fontSize: 14, padding: '6px 12px', lineHeight: 1.5 }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--ant-color-primary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
                  onClick={() => handleSend(prompt)}
                >
                  {prompt}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <Bubble
                key={msg.id}
                placement={msg.role === 'user' ? 'end' : 'start'}
                content={
                  <div aria-label={`${msg.role} message`}>
                    {msg.role === 'user' ? (
                      <div className="text-sm">{msg.content}</div>
                    ) : (
                      <>
                        {/* Timeline-based rendering for new messages */}
                        {msg.timeline && msg.timeline.length > 0 ? (
                          <AssistantTimeline timeline={msg.timeline} />
                        ) : (
                          /* Legacy rendering for old stored conversations */
                          <>
                            {msg.thinking && (
                              <Typography className="text-sm text-gray-600">
                                <XMarkdown content={msg.thinking} />
                              </Typography>
                            )}
                            {msg.toolCalls?.map((tc, i) => (
                              <Tag key={i} color="blue" className="mt-1 mr-1">
                                {tc.name}
                              </Tag>
                            ))}
                          </>
                        )}
                        {msg.config && !dismissedConfigs.has(msg.id) && (
                          <ConfigPreview
                            config={msg.config}
                            onApply={() => handleApplyConfig(msg.id, msg.config!)}
                            onDismiss={() => handleDismissConfig(msg.id)}
                          />
                        )}
                        {msg.error && <div className="text-red-500 text-sm mt-1">{msg.error}</div>}
                      </>
                    )}
                  </div>
                }
                loading={msg.status === 'pending' || msg.status === 'streaming'}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Status indicator */}
      {status === 'connecting' && (
        <div className="flex items-center gap-2 px-4 py-2 text-gray-500 text-sm">
          <Spin size="small" /> Connecting...
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-100 p-4">
        <div className="rounded-lg overflow-hidden transition-shadow [&:focus-within]:shadow-[0_0_0_2px_var(--ant-color-primary)]">
          <Sender
            ref={inputRef}
            value={inputValue}
            onChange={setInputValue}
            placeholder="Describe the report you want..."
            onSubmit={handleSend}
            loading={isStreaming}
            disabled={isStreaming}
            aria-label="Chat input"
          />
        </div>
        {usage.costUsd > 0 && (
          <Tooltip title={`${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out`}>
            <div className="text-xs text-gray-400 mt-2 text-center cursor-default">
              ${usage.costUsd.toFixed(4)}
            </div>
          </Tooltip>
        )}
      </div>
    </div>
  )

  const content = view === 'chat' ? chatContent : <HistoryView />

  // Use Drawer on mobile, Card on desktop
  if (isMobile) {
    return (
      <Drawer
        title={title}
        extra={extra}
        open={isOpen}
        onClose={() => setIsOpen(false)}
        placement="bottom"
        height="80vh"
        zIndex={1100}
        styles={{ body: { padding: 0 } }}
        destroyOnClose={false}
      >
        {content}
      </Drawer>
    )
  }

  return (
    <Card
      className="shadow-xl"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 90,
        zIndex: 50,
        width: 576,
        // Hide with visibility to keep component mounted and avoid ResizeObserver cleanup issues
        visibility: isOpen ? 'visible' : 'hidden',
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transition: 'opacity 0.2s, visibility 0.2s',
      }}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: 720 } }}
      title={title}
      extra={extra}
    >
      {content}
    </Card>
  )
}
