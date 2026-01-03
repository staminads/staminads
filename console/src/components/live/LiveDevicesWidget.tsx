import { Tooltip, Empty, Spin } from 'antd'
import { Monitor, Smartphone, Tablet } from 'lucide-react'

interface DeviceData {
  device: string
  sessions: number
}

interface LiveDevicesWidgetProps {
  data: DeviceData[]
  loading: boolean
}

const deviceIcons: Record<string, React.ReactNode> = {
  desktop: <Monitor size={14} className="text-gray-500" />,
  mobile: <Smartphone size={14} className="text-gray-500" />,
  tablet: <Tablet size={14} className="text-gray-500" />,
}

export function LiveDevicesWidget({ data, loading }: LiveDevicesWidgetProps) {
  const maxValue = data[0]?.sessions ?? 1

  if (loading && data.length === 0) {
    return (
      <div className="rounded-md overflow-hidden bg-white">
        <div className="px-4 pt-4 pb-4">
          <h3 className="text-base font-semibold text-gray-900">Devices</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Spin />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md overflow-hidden bg-white">
      <div className="px-4 pt-4 pb-4">
        <h3 className="text-base font-semibold text-gray-900">Devices</h3>
      </div>

      {data.length === 0 ? (
        <Empty
          description="No device data"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <div className="flex flex-col">
          {data.map((row, index) => {
            const percent = (row.sessions / maxValue) * 100
            const displayDevice = row.device || 'Unknown'
            const icon = deviceIcons[displayDevice.toLowerCase()]

            return (
              <div
                key={`${row.device}-${index}`}
                className="group/row relative flex items-center h-9 px-4 border-b border-transparent hover:border-[var(--primary)]"
              >
                <div className="relative flex-1 min-w-0 pr-4 h-full flex items-center pl-0.5 gap-2">
                  <div
                    className="absolute left-0 top-1 bottom-1 bg-[var(--primary)] opacity-[0.06] pointer-events-none rounded"
                    style={{ width: `${percent}%`, minWidth: '0.5rem' }}
                  />
                  {icon && <span className="flex-shrink-0 relative">{icon}</span>}
                  <Tooltip title={displayDevice} placement="topLeft">
                    <span className="relative truncate block text-xs text-gray-700 group-hover/row:text-gray-900 capitalize">
                      {displayDevice}
                    </span>
                  </Tooltip>
                </div>
                <div className="w-12 text-right">
                  <span className="text-xs text-gray-800">{row.sessions}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
