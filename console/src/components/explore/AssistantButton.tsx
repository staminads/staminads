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
        icon={isOpen ? <CloseOutlined /> : <Sparkles size={22} color="#ffec3d" />}
        type="primary"
        onClick={onClick}
        style={{ right: 24, bottom: 24, width: 56, height: 56 }}
      />
    </Tooltip>
  )
}
