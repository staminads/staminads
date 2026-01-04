import { createContext } from 'react'

export interface AuthUser {
  id: string
  email: string
  name: string
  isSuperAdmin: boolean
}

export interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)
