import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { ConfigProvider, Result, Button } from 'antd'
import type { RouterContext } from '../router'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#7763f1',
        },
      }}
    >
      <Outlet />
    </ConfigProvider>
  ),
  errorComponent: ({ error }) => (
    <ConfigProvider>
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Result
          status="error"
          title="Something went wrong"
          subTitle={error?.message || 'An unexpected error occurred'}
          extra={
            <Button type="primary" onClick={() => window.location.href = '/'}>
              Go Home
            </Button>
          }
        />
      </div>
    </ConfigProvider>
  ),
})
