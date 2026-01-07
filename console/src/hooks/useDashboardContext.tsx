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
  showEvoDetails: boolean
  setShowEvoDetails: (value: boolean) => void
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
  showEvoDetails,
  setShowEvoDetails,
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
      showEvoDetails,
      setShowEvoDetails,
    }),
    [workspaceId, dateRange, compareDateRange, timezone, globalFilters, showComparison, timescoreReference, showEvoDetails, setShowEvoDetails]
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardContext(): DashboardContextValue {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboardContext must be used within a DashboardProvider')
  }
  return context
}
