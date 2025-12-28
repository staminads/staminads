import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Spin } from 'antd'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  },
  component: AuthenticatedLayout,
  pendingComponent: () => (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <Spin size="large" />
    </div>
  ),
})

function AuthenticatedLayout() {
  return (
    <div
      className="min-h-screen flex flex-col bg-cover bg-center"
      style={{ backgroundImage: 'url(/background.jpg)' }}
    >
      <Outlet />
    </div>
  )
}
