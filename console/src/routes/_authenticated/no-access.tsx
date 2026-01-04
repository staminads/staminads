import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button, Result } from 'antd'
import { useAuth } from '../../lib/useAuth'

export const Route = createFileRoute('/_authenticated/no-access')({
  component: NoAccessPage,
})

function NoAccessPage() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate({ to: '/login' })
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center"
      style={{ backgroundImage: 'url(/background.jpg)' }}
    >
      <div className="bg-white/95 backdrop-blur-sm p-8 rounded-lg shadow-xl w-full max-w-md text-center">
        <Result
          status="403"
          title="No Workspace Access"
          subTitle="You don't have access to any workspaces. Please contact your administrator to be invited to a workspace."
          extra={
            <Button type="primary" onClick={handleLogout}>
              Sign Out
            </Button>
          }
        />
      </div>
    </div>
  )
}
