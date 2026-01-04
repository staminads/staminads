import { useState, type ReactNode } from 'react'
import { AuthContext, type AuthUser } from './AuthContext'

// Re-export types for convenience
export type { AuthState, AuthUser } from './AuthContext'

// Helper to get token from localStorage (runs once during initial render)
function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

// Helper to get user from localStorage (runs once during initial render)
function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem('user')
  if (!stored) return null
  try {
    return JSON.parse(stored) as AuthUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use lazy initialization to avoid useEffect
  const [token, setToken] = useState<string | null>(getStoredToken)
  const [user, setUser] = useState<AuthUser | null>(getStoredUser)
  // Since we're using lazy init, loading is false immediately
  const [isLoading] = useState(false)

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth.login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error('Invalid credentials')
    const { access_token, user: userData } = await res.json()
    const authUser: AuthUser = {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      isSuperAdmin: userData.is_super_admin,
    }
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(authUser))
    setToken(access_token)
    setUser(authUser)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{
      token,
      user,
      isAuthenticated: !!token,
      isLoading,
      login,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  )
}

