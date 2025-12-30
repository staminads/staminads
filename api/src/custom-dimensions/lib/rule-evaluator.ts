import * as crypto from 'crypto';
import {
  CustomDimensionCondition,
  CustomDimensionDefinition,
  CustomDimensionRule,
} from '../entities/custom-dimension.entity';

/**
 * Compute a version hash from rules configuration.
 * Used to detect when stored custom dimension values are stale.
 */
export function computeVersion(
  rules: CustomDimensionRule[],
  defaultValue?: string,
): string {
  const content = JSON.stringify({ rules, defaultValue });
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

/**
 * Evaluate a single condition against event field values.
 */
export function evaluateCondition(
  condition: CustomDimensionCondition,
  fieldValues: Record<string, string | null | undefined>,
): boolean {
  const fieldValue = fieldValues[condition.field];

  // Null/undefined field values never match (except for specific operators if we add them later)
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
 * Evaluate a rule (all conditions must match - AND logic).
 */
export function evaluateRule(
  rule: CustomDimensionRule,
  fieldValues: Record<string, string | null | undefined>,
): boolean {
  // Empty conditions array means the rule always matches
  if (rule.conditions.length === 0) {
    return true;
  }

  // All conditions must match (AND logic)
  return rule.conditions.every((condition) =>
    evaluateCondition(condition, fieldValues),
  );
}

/**
 * Evaluate all rules in a custom dimension definition.
 * Returns the output value of the first matching rule, or defaultValue, or null.
 */
export function evaluateRules(
  definition: CustomDimensionDefinition,
  fieldValues: Record<string, string | null | undefined>,
): string | null {
  for (const rule of definition.rules) {
    if (evaluateRule(rule, fieldValues)) {
      return rule.outputValue;
    }
  }

  return definition.defaultValue ?? null;
}

/**
 * Result of computing custom dimensions for an event.
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
}

/**
 * Compute all custom dimension values for an event based on workspace definitions.
 */
export function computeCustomDimensions(
  definitions: CustomDimensionDefinition[],
  fieldValues: Record<string, string | null | undefined>,
): CustomDimensionValues {
  // Initialize all slots to null
  const result: CustomDimensionValues = {
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
  };

  // Evaluate each definition and store in its slot
  for (const definition of definitions) {
    const slot = definition.slot;
    if (slot < 1 || slot > 10) {
      continue; // Invalid slot, skip
    }

    const value = evaluateRules(definition, fieldValues);
    const valueKey = `cd_${slot}` as keyof CustomDimensionValues;
    result[valueKey] = value;
  }

  return result;
}

/**
 * Extract field values from an event for rule evaluation.
 * Maps event properties to field names used in custom dimension conditions.
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
  fields['referrer_domain'] = event['referrer_domain'] as string | null | undefined;
  fields['referrer_path'] = event['referrer_path'] as string | null | undefined;
  fields['is_direct'] = event['is_direct'] ? 'true' : 'false';

  // Page fields
  fields['landing_page'] = event['landing_page'] as string | null | undefined;
  fields['landing_domain'] = event['landing_domain'] as string | null | undefined;
  fields['landing_path'] = event['landing_path'] as string | null | undefined;
  fields['path'] = event['path'] as string | null | undefined;

  // Device fields
  fields['device'] = event['device'] as string | null | undefined;
  fields['browser'] = event['browser'] as string | null | undefined;
  fields['browser_type'] = event['browser_type'] as string | null | undefined;
  fields['os'] = event['os'] as string | null | undefined;
  fields['user_agent'] = event['user_agent'] as string | null | undefined;
  fields['connection_type'] = event['connection_type'] as string | null | undefined;

  // Geo/locale fields
  fields['language'] = event['language'] as string | null | undefined;
  fields['timezone'] = event['timezone'] as string | null | undefined;

  return fields;
}
