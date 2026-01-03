import { Tooltip, Empty, Spin } from 'antd'

interface PageData {
  landing_path: string
  sessions: number
}

interface LivePagesWidgetProps {
  data: PageData[]
  loading: boolean
  workspaceId: string
}

export function LivePagesWidget({ data, loading, workspaceId }: LivePagesWidgetProps) {
  const maxValue = data[0]?.sessions ?? 1

  if (loading && data.length === 0) {
    return (
      <div className="rounded-md overflow-hidden bg-white">
        <div className="px-4 pt-4 pb-4">
          <h3 className="text-base font-semibold text-gray-900">Top Pages</h3>
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
        <h3 className="text-base font-semibold text-gray-900">Top Pages</h3>
      </div>

      {data.length === 0 ? (
        <Empty
          description="No page views"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          className="py-8"
        />
      ) : (
        <div className="flex flex-col">
          {data.map((row) => {
            const percent = (row.sessions / maxValue) * 100
            const displayPath = row.landing_path || '/'

            return (
              <a
                key={row.landing_path}
                href={`https://${workspaceId}${displayPath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group/row relative flex items-center h-9 px-4 border-b border-transparent hover:border-[var(--primary)]"
              >
                <div className="relative flex-1 min-w-0 pr-4 h-full flex items-center pl-0.5">
                  <div
                    className="absolute left-0 top-1 bottom-1 bg-[var(--primary)] opacity-[0.06] pointer-events-none rounded"
                    style={{ width: `${percent}%`, minWidth: '0.5rem' }}
                  />
                  <Tooltip title={displayPath} placement="topLeft">
                    <span className="relative truncate block text-xs text-gray-700 group-hover/row:text-gray-900">
                      {displayPath}
                    </span>
                  </Tooltip>
                </div>
                <div className="w-12 text-right">
                  <span className="text-xs text-gray-800">{row.sessions}</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
