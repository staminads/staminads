import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App, ConfigProvider } from 'antd'
import type { ThemeConfig } from 'antd'
import { createAppRouter } from './router'
import { AuthProvider, useAuth } from './lib/auth'
import './index.css'
import 'flag-icons/css/flag-icons.min.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
    },
  },
})

const router = createAppRouter(queryClient)

const theme: ThemeConfig = {
  token: {
    colorPrimary: '#7763F1',
    colorLink: '#7763F1',
  },
  components: {
    Card: {
      headerFontSize: 16,
      borderRadius: 4,
      borderRadiusLG: 4,
      borderRadiusSM: 4,
      borderRadiusXS: 4,
    },
    Table: {
      headerBg: 'transparent',
      fontSize: 12,
      colorTextHeading: 'rgb(51 65 85)',
    },
  },
}

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
        <ConfigProvider theme={theme}>
          <App>
            <InnerApp />
          </App>
        </ConfigProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
