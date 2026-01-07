import { FloatButton, Tooltip } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { Sparkles } from 'lucide-react'

interface AssistantButtonProps {
  isOpen: boolean
  onClick: () => void
  hasMessages?: boolean
}

export function AssistantButton({ isOpen, onClick }: AssistantButtonProps) {
  return (
    <Tooltip title={isOpen ? 'Close assistant' : 'Ask AI to create a report'} placement="left">
      <FloatButton
        icon={isOpen ? <CloseOutlined /> : <Sparkles size={22} color="white" />}
        type="primary"
        onClick={onClick}
        className={`!w-12 !h-12 md:!w-14 md:!h-14 !right-4 !bottom-4 md:!right-6 md:!bottom-6 ${isOpen ? 'max-md:!hidden' : ''}`}
      />
    </Tooltip>
  )
}
