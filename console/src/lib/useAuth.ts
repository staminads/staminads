import { useContext } from 'react'
import { AuthContext, type AuthState } from './AuthContext'

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
