import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/logout')({
  beforeLoad: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    throw redirect({ to: '/login' })
  },
  component: () => null,
})
