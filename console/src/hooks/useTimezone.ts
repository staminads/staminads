import { useCallback } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { WorkspaceSearch } from '../types/dashboard'

/**
 * Global timezone hook for managing timezone across all workspace pages.
 * Timezone is stored in URL search params and persisted across navigation.
 */
export function useTimezone(workspaceTimezone: string) {
  const search = useSearch({ strict: false }) as WorkspaceSearch
  const navigate = useNavigate()

  const timezone = search.timezone ?? workspaceTimezone

  const setTimezone = useCallback(
    (newTimezone: string) => {
      navigate({
        search: { ...search, timezone: newTimezone } as never,
        replace: true,
      })
    },
    [navigate, search],
  )

  return {
    timezone,
    setTimezone,
    workspaceTimezone,
  }
}
