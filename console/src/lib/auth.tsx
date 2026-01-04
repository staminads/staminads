import { useState, type ReactNode } from 'react'
import { AuthContext } from './AuthContext'

// Re-export types for convenience
export type { AuthState } from './AuthContext'

// Helper to get token from localStorage (runs once during initial render)
function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use lazy initialization to avoid useEffect
  const [token, setToken] = useState<string | null>(getStoredToken)
  // Since we're using lazy init, loading is false immediately
  const [isLoading] = useState(false)

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error('Invalid credentials')
    const { access_token } = await res.json()
    localStorage.setItem('token', access_token)
    setToken(access_token)
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
  }

  return (
    <AuthContext.Provider value={{
      token,
      isAuthenticated: !!token,
      isLoading,
      login,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  )
}

