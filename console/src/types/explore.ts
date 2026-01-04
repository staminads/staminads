import type { Filter, DatePreset } from './analytics'
import type { ComparisonMode } from './dashboard'

/**
 * URL search params for the explore page
 */
export interface ExploreSearch {
  period?: DatePreset
  timezone?: string
  comparison?: ComparisonMode
  customStart?: string
  customEnd?: string
  dimensions?: string // Comma-separated dimension list
  filters?: string // JSON-encoded Filter[]
  minSessions?: string // Stored as string in URL, parsed to number
}

/**
 * Row structure for the explore table with hierarchical data
 */
export interface ExploreRow {
  key: string // Unique key including parent path (e.g., "google:black-friday")
  parentDimensionIndex: number // Level in hierarchy (0, 1, 2...)
  childrenLoaded: boolean // Whether children have been fetched
  children?: ExploreRow[] // Child rows
  isLoading?: boolean // Currently fetching children
  childrenFilteredByMinSessions?: boolean // Children were likely filtered out by min sessions threshold

  // Dimension values - dynamic keys based on selected dimensions
  [dimensionKey: string]: unknown

  // Metrics - current period
  sessions: number
  median_duration: number
  bounce_rate: number
  median_scroll: number

  // Metrics - previous period (when comparison enabled)
  sessions_prev?: number
  median_duration_prev?: number
  bounce_rate_prev?: number
  median_scroll_prev?: number

  // Change percentages
  sessions_change?: number
  median_duration_change?: number
  bounce_rate_change?: number
  median_scroll_change?: number
}

/**
 * Configuration for explore queries
 */
export interface ExploreConfig {
  dimensions: string[]
  filters: Filter[]
  minSessions: number
}

/**
 * Result from calculateChildrenDimensionsAndFilters
 */
export interface ChildrenQueryConfig {
  currentDimensionIndex: number
  dimensionsToFetch: string[]
  filters: Filter[]
}

/**
 * Heat map range for coloring cells
 */
export interface HeatMapRange {
  bestValue: number
  worstValue: number
}

/**
 * Overall totals for the current query (without dimension grouping)
 * Used for calculating percentages and displaying summary stats
 */
export interface ExploreTotals {
  sessions: number
  median_duration: number
  bounce_rate: number
  median_scroll: number
  // Previous period values (when comparison enabled)
  sessions_prev?: number
  median_duration_prev?: number
  bounce_rate_prev?: number
  median_scroll_prev?: number
  // Change percentages
  sessions_change?: number
  median_duration_change?: number
  bounce_rate_change?: number
  median_scroll_change?: number
}

/**
 * Dimension definition from API
 */
export interface DimensionInfo {
  name: string
  type: 'string' | 'number' | 'boolean'
  category: string
}

/**
 * Grouped dimensions by category for selector UI
 */
export type DimensionsByCategory = Record<string, DimensionInfo[]>
