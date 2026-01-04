import type { AnalyticsResponse } from '../types/analytics'
import type { DimensionData } from '../types/dashboard'

/**
 * Transforms an analytics API response to the standard DimensionData format.
 * Handles both comparison and non-comparison responses.
 *
 * @param response - The raw analytics API response
 * @param dimensionField - The field name containing the dimension value (e.g., 'device', 'landing_path')
 * @returns Array of DimensionData objects
 */
export function transformToDimensionData(
  response: AnalyticsResponse | undefined,
  dimensionField: string
): DimensionData[] {
  if (!response?.data) return []

  // Check if response has comparison data structure
  const hasComparison =
    typeof response.data === 'object' &&
    'current' in response.data &&
    Array.isArray(response.data.current)

  if (hasComparison) {
    const { current, previous } = response.data as {
      current: Record<string, unknown>[]
      previous: Record<string, unknown>[]
    }

    return current.map((row) => {
      const dimensionValue = row[dimensionField] as string
      const prevRow = previous?.find((p) => p[dimensionField] === dimensionValue)

      return {
        dimension_value: dimensionValue ?? '',
        sessions: (row.sessions as number) ?? 0,
        median_duration: (row.median_duration as number) ?? 0,
        prev_sessions: prevRow?.sessions as number | undefined,
        prev_median_duration: prevRow?.median_duration as number | undefined,
      }
    })
  }

  // No comparison - flat array
  const rows = response.data as Record<string, unknown>[]
  return rows.map((row) => ({
    dimension_value: (row[dimensionField] as string) ?? '',
    sessions: (row.sessions as number) ?? 0,
    median_duration: (row.median_duration as number) ?? 0,
  }))
}
