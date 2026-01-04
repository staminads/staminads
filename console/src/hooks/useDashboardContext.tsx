import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { DashboardContextValue } from '../types/dashboard'
import type { DateRange, Filter } from '../types/analytics'

const DashboardContext = createContext<DashboardContextValue | null>(null)

export interface DashboardProviderProps {
  children: ReactNode
  workspaceId: string
  dateRange: DateRange
  compareDateRange?: DateRange
  timezone: string
  globalFilters?: Filter[]
  showComparison: boolean
  timescoreReference: number
}

export function DashboardProvider({
  children,
  workspaceId,
  dateRange,
  compareDateRange,
  timezone,
  globalFilters = [],
  showComparison,
  timescoreReference,
}: DashboardProviderProps) {
  const value = useMemo<DashboardContextValue>(
    () => ({
      workspaceId,
      dateRange,
      compareDateRange,
      timezone,
      globalFilters,
      showComparison,
      timescoreReference,
    }),
    [workspaceId, dateRange, compareDateRange, timezone, globalFilters, showComparison, timescoreReference]
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboardContext(): DashboardContextValue {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboardContext must be used within a DashboardProvider')
  }
  return context
}
