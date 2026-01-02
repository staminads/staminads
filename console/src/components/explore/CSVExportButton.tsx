import { Button, Tooltip } from 'antd'
import { Download } from 'lucide-react'

interface CSVExportButtonProps {
  onClick: () => void
  disabled?: boolean
}

export function CSVExportButton({ onClick, disabled }: CSVExportButtonProps) {
  return (
    <Tooltip title="Export to CSV">
      <Button
        type="text"
        icon={<Download size={16} />}
        onClick={onClick}
        disabled={disabled}
        size="small"
      />
    </Tooltip>
  )
}
