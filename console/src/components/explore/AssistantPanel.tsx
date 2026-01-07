import { useRef, useEffect, useState } from 'react'
import { Card, Button, Tag, Drawer, Spin, Typography, Space } from 'antd'
import { ThunderboltOutlined, CheckOutlined } from '@ant-design/icons'
import { Bubble, Sender } from '@ant-design/x'
import { XMarkdown } from '@ant-design/x-markdown'
import '@ant-design/x-markdown/themes/light.css'
import type { SenderRef } from '@ant-design/x/es/sender/interface'
import type { Message, ExploreConfigOutput, AssistantStatus, ConversationUsage } from '../../types/assistant'

interface AssistantPanelProps {
  messages: Message[]
  status: AssistantStatus
  usage: ConversationUsage
  isStreaming: boolean
  onSend: (prompt: string) => void
  onClear: () => void
  onClose: () => void
  onApplyConfig?: (config: ExploreConfigOutput) => void
}

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
          <li>• <span className="text-gray-500">Dimensions:</span> {config.dimensions.join(', ')}</li>
        )}
        {config.period && (
          <li>• <span className="text-gray-500">Period:</span> {config.period}</li>
        )}
        {config.filters && config.filters.length > 0 && (
          <li>• <span className="text-gray-500">Filters:</span> {config.filters.length} filter(s)</li>
        )}
        {config.comparison && config.comparison !== 'none' && (
          <li>• <span className="text-gray-500">Comparison:</span> {config.comparison}</li>
        )}
      </ul>
      <Space>
        <Button type="primary" size="small" icon={<CheckOutlined />} onClick={onApply}>
          View Report
        </Button>
        <Button size="small" onClick={onDismiss}>Dismiss</Button>
      </Space>
    </div>
  )
}

export function AssistantPanel({
  messages,
  status,
  usage,
  isStreaming,
  onSend,
  onClear,
  onClose,
  onApplyConfig,
}: AssistantPanelProps) {
  const inputRef = useRef<SenderRef>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const [dismissedConfigs, setDismissedConfigs] = useState<Set<string>>(new Set())

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Keyboard navigation (Escape to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSend = (text: string) => {
    if (text.trim() && !isStreaming) {
      onSend(text.trim())
    }
  }

  const handleApplyConfig = (msgId: string, config: ExploreConfigOutput) => {
    onApplyConfig?.(config)
    setDismissedConfigs(prev => new Set(prev).add(msgId))
  }

  const handleDismissConfig = (msgId: string) => {
    setDismissedConfigs(prev => new Set(prev).add(msgId))
  }

  const content = (
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
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--ant-color-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
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
                        {msg.config && !dismissedConfigs.has(msg.id) && (
                          <ConfigPreview
                            config={msg.config}
                            onApply={() => handleApplyConfig(msg.id, msg.config!)}
                            onDismiss={() => handleDismissConfig(msg.id)}
                          />
                        )}
                        {msg.error && (
                          <div className="text-red-500 text-sm mt-1">{msg.error}</div>
                        )}
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
            placeholder="Describe the report you want..."
            onSubmit={handleSend}
            loading={isStreaming}
            disabled={isStreaming}
            aria-label="Chat input"
          />
        </div>
        {usage.costUsd > 0 && (
          <div className="text-xs text-gray-400 mt-2 text-center">
            {usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out · ${usage.costUsd.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  )

  const title = (
    <div className="flex items-center gap-2">
      <ThunderboltOutlined />
      <span>AI Assistant</span>
    </div>
  )

  const extra = messages.length > 0 ? (
    <Button
      type="link"
      size="small"
      onClick={onClear}
      aria-label="Reset conversation"
    >
      Reset
    </Button>
  ) : null

  // Use Drawer on mobile, Card on desktop
  if (isMobile) {
    return (
      <Drawer
        title={title}
        extra={extra}
        open
        onClose={onClose}
        placement="bottom"
        height="80vh"
        zIndex={1100}
        styles={{ body: { padding: 0 } }}
      >
        {content}
      </Drawer>
    )
  }

  return (
    <Card
      className="w-96 shadow-xl"
      style={{ position: 'fixed', right: 24, bottom: 90, zIndex: 50 }}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: 480 } }}
      title={title}
      extra={extra}
    >
      {content}
    </Card>
  )
}
