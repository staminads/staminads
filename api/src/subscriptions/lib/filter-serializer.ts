import { FilterDto } from '../../analytics/dto/analytics-query.dto';

/**
 * Serialize filters array to JSON string for database storage.
 */
export function serializeFilters(filters: FilterDto[] | undefined): string {
  return JSON.stringify(filters ?? []);
}

/**
 * Deserialize filters JSON string from database to array.
 * Returns empty array on parse failure for safety.
 */
export function deserializeFilters(
  filtersJson: string | null | undefined,
): FilterDto[] {
  if (!filtersJson) return [];
  try {
    return JSON.parse(filtersJson);
  } catch (error) {
    console.warn('Failed to parse filters JSON, using empty array:', error);
    return [];
  }
}
