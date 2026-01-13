import { Drawer, Skeleton } from 'antd'

interface PreviewDrawerProps {
  open: boolean
  onClose: () => void
  html: string | null
  loading: boolean
}

export function PreviewDrawer({ open, onClose, html, loading }: PreviewDrawerProps) {
  return (
    <Drawer
      title="Email Preview"
      placement="right"
      width={700}
      open={open}
      onClose={onClose}
    >
      {loading ? (
        <div className="space-y-4">
          {/* Header skeleton */}
          <Skeleton.Input active block style={{ height: 80 }} />

          {/* Metrics row skeleton */}
          <div className="flex gap-4">
            <Skeleton.Input active style={{ width: '25%', height: 60 }} />
            <Skeleton.Input active style={{ width: '25%', height: 60 }} />
            <Skeleton.Input active style={{ width: '25%', height: 60 }} />
            <Skeleton.Input active style={{ width: '25%', height: 60 }} />
          </div>

          {/* Table skeletons */}
          <Skeleton active paragraph={{ rows: 6 }} />
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : html ? (
        <iframe
          srcDoc={html}
          title="Email Preview"
          className="w-full h-full border-0"
          style={{ minHeight: 'calc(100vh - 120px)' }}
        />
      ) : null}
    </Drawer>
  )
}
