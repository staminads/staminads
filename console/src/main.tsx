import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppRouter } from './router'
import { AuthProvider, useAuth } from './lib/auth'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
    },
  },
})

const router = createAppRouter(queryClient)

function InnerApp() {
  const auth = useAuth()

  if (auth.isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  return <RouterProvider router={router} context={{ auth, queryClient }} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <InnerApp />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
