import * as crypto from 'crypto';
import {
  FilterCondition,
  FilterDefinition,
} from '../entities/filter.entity';

/**
 * Compute a version hash from all filter configurations.
 * Used to detect when stored filter values are stale.
 */
export function computeFilterVersion(filters: FilterDefinition[]): string {
  // Sort by id for consistent hashing
  const sortedFilters = [...filters].sort((a, b) => a.id.localeCompare(b.id));
  const content = JSON.stringify(
    sortedFilters.map((f) => ({
      id: f.id,
      conditions: f.conditions,
      operations: f.operations,
      enabled: f.enabled,
      priority: f.priority,
    })),
  );
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

/**
 * Evaluate a single condition against event field values.
 */
export function evaluateCondition(
  condition: FilterCondition,
  fieldValues: Record<string, string | null | undefined>,
): boolean {
  const fieldValue = fieldValues[condition.field];

  // Null/undefined field values never match
  if (fieldValue == null) {
    return false;
  }

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;

    case 'contains':
      return fieldValue.includes(condition.value);

    case 'regex':
      try {
        const regex = new RegExp(condition.value);
        return regex.test(fieldValue);
      } catch {
        // Invalid regex never matches
        return false;
      }

    default:
      return false;
  }
}

/**
 * Evaluate all conditions (all must match - AND logic).
 */
export function evaluateConditions(
  conditions: FilterCondition[],
  fieldValues: Record<string, string | null | undefined>,
): boolean {
  // Empty conditions array means the filter always matches
  if (conditions.length === 0) {
    return true;
  }

  // All conditions must match (AND logic)
  return conditions.every((condition) =>
    evaluateCondition(condition, fieldValues),
  );
}

/**
 * Result of evaluating filters for an event.
 */
export interface FilterResult {
  [dimension: string]: string | null;
}

export interface FilterResultWithVersion extends FilterResult {
  filter_version: string;
}

/**
 * Evaluate all filters for an event and compute dimension values.
 *
 * Algorithm:
 * 1. Sort filters by priority (highest first)
 * 2. For each filter:
 *    a. Check if ALL conditions match (AND logic)
 *    b. If matched and enabled, execute operations
 * 3. Operations execute based on priority:
 *    - set_value: Always sets dimension, higher priority wins
 *    - unset_value: Sets dimension to null, higher priority wins
 *    - set_default_value: Only sets if dimension is currently null
 */
export function evaluateFilters(
  filters: FilterDefinition[],
  fieldValues: Record<string, string | null | undefined>,
): FilterResult {
  // Result accumulator for all writable dimensions
  const result: FilterResult = {};

  // Track which dimensions have been set by which priority
  const dimensionPriorities: Record<string, number> = {};

  // Sort by priority (highest first)
  const sortedFilters = [...filters]
    .filter((f) => f.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const filter of sortedFilters) {
    // Check if ALL conditions match (AND logic)
    const matches = evaluateConditions(filter.conditions, fieldValues);

    if (!matches) continue;

    // Execute operations
    for (const op of filter.operations) {
      const currentPriority = dimensionPriorities[op.dimension] ?? -1;

      switch (op.action) {
        case 'set_value':
          // Skip if higher priority already set this dimension
          if (filter.priority < currentPriority) continue;
          result[op.dimension] = op.value!;
          dimensionPriorities[op.dimension] = filter.priority;
          break;

        case 'unset_value':
          // Skip if higher priority already set this dimension
          if (filter.priority < currentPriority) continue;
          result[op.dimension] = null;
          dimensionPriorities[op.dimension] = filter.priority;
          break;

        case 'set_default_value':
          // Only set if not already set (regardless of priority)
          if (!(op.dimension in result) || result[op.dimension] === null) {
            result[op.dimension] = op.value!;
            // Don't update priority - allow other filters to override
          }
          break;
      }
    }
  }

  return result;
}

/**
 * Compute all dimension values for an event based on workspace filters.
 * Returns the filter result plus the filter_version for staleness tracking.
 */
export function computeFilteredDimensions(
  filters: FilterDefinition[],
  fieldValues: Record<string, string | null | undefined>,
): FilterResultWithVersion {
  const result = evaluateFilters(filters, fieldValues);
  const version = computeFilterVersion(filters);

  return {
    ...result,
    filter_version: version,
  };
}

/**
 * Extract field values from an event for rule evaluation.
 * Maps event properties to field names used in filter conditions.
 */
export function extractFieldValues(
  event: Record<string, unknown>,
): Record<string, string | null | undefined> {
  const fields: Record<string, string | null | undefined> = {};

  // UTM fields
  const utmFields = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'utm_id_from',
  ];
  for (const field of utmFields) {
    fields[field] = event[field] as string | null | undefined;
  }

  // Traffic fields
  fields['referrer'] = event['referrer'] as string | null | undefined;
  fields['referrer_domain'] = event['referrer_domain'] as
    | string
    | null
    | undefined;
  fields['referrer_path'] = event['referrer_path'] as string | null | undefined;
  fields['is_direct'] = event['is_direct'] ? 'true' : 'false';

  // Page fields
  fields['landing_page'] = event['landing_page'] as string | null | undefined;
  fields['landing_domain'] = event['landing_domain'] as
    | string
    | null
    | undefined;
  fields['landing_path'] = event['landing_path'] as string | null | undefined;
  fields['path'] = event['path'] as string | null | undefined;

  // Device fields
  fields['device'] = event['device'] as string | null | undefined;
  fields['browser'] = event['browser'] as string | null | undefined;
  fields['browser_type'] = event['browser_type'] as string | null | undefined;
  fields['os'] = event['os'] as string | null | undefined;
  fields['user_agent'] = event['user_agent'] as string | null | undefined;
  fields['connection_type'] = event['connection_type'] as
    | string
    | null
    | undefined;

  // Geo/locale fields
  fields['language'] = event['language'] as string | null | undefined;
  fields['timezone'] = event['timezone'] as string | null | undefined;

  return fields;
}

/**
 * Build the complete custom dimension values object for an event.
 * Initializes all cd_* slots to null and applies filter results.
 */
export interface CustomDimensionValues {
  cd_1: string | null;
  cd_2: string | null;
  cd_3: string | null;
  cd_4: string | null;
  cd_5: string | null;
  cd_6: string | null;
  cd_7: string | null;
  cd_8: string | null;
  cd_9: string | null;
  cd_10: string | null;
  filter_version: string | null;
}

/**
 * Apply filter results to create the complete event values.
 * This handles both custom dimensions (cd_1...cd_10) and standard dimensions.
 */
export function applyFilterResults(
  filters: FilterDefinition[],
  fieldValues: Record<string, string | null | undefined>,
  baseEvent: Record<string, unknown>,
): { customDimensions: CustomDimensionValues; modifiedFields: Record<string, string | null> } {
  const filterResult = computeFilteredDimensions(filters, fieldValues);
  const version = filterResult.filter_version;

  // Initialize custom dimension values
  const customDimensions: CustomDimensionValues = {
    cd_1: null,
    cd_2: null,
    cd_3: null,
    cd_4: null,
    cd_5: null,
    cd_6: null,
    cd_7: null,
    cd_8: null,
    cd_9: null,
    cd_10: null,
    filter_version: version,
  };

  // Track modified standard fields (utm_*, referrer_domain, is_direct)
  const modifiedFields: Record<string, string | null> = {};

  // Apply filter results
  for (const [dimension, value] of Object.entries(filterResult)) {
    if (dimension === 'filter_version') continue;

    // Check if it's a custom dimension slot
    const cdMatch = dimension.match(/^cd_(\d+)$/);
    if (cdMatch) {
      const slot = parseInt(cdMatch[1], 10);
      if (slot >= 1 && slot <= 10) {
        const valueKey = `cd_${slot}` as keyof CustomDimensionValues;
        customDimensions[valueKey] = value;
      }
    } else {
      // Standard dimension (utm_*, referrer_domain, is_direct)
      modifiedFields[dimension] = value;
    }
  }

  return { customDimensions, modifiedFields };
}
