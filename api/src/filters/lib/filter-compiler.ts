import {
  FilterCondition,
  FilterDefinition,
  FilterAction,
  VALID_SOURCE_FIELDS,
  VALID_WRITABLE_DIMENSIONS,
} from '../entities/filter.entity';
import { computeFilterVersion } from './filter-evaluator';

/**
 * Result of compiling filters to ClickHouse SQL.
 */
export interface CompiledFilters {
  /** SET clause for UPDATE statement (channel = CASE..., cd_1 = CASE...) */
  setClause: string;
  /** Filter version hash for idempotency */
  filterVersion: string;
}

/**
 * Branch in a CASE expression.
 */
interface CaseBranch {
  conditionSQL: string;
  action: FilterAction;
  value?: string;
}

/**
 * All custom dimensions that must be set in every update.
 * Current behavior resets ALL dimensions unless explicitly set by a filter.
 */
const CUSTOM_DIMENSIONS = [
  'channel',
  'channel_group',
  'stm_1',
  'stm_2',
  'stm_3',
  'stm_4',
  'stm_5',
  'stm_6',
  'stm_7',
  'stm_8',
  'stm_9',
  'stm_10',
];

/**
 * Escape a string value for ClickHouse SQL.
 * Must escape backslashes first, then single quotes.
 */
export function escapeSQL(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Escape a regex pattern for ClickHouse match() function.
 * ClickHouse uses re2 regex syntax.
 */
export function escapeRegex(pattern: string): string {
  // Escape backslashes and quotes for SQL string embedding
  return pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Validate that a field name is a valid source field.
 * Defense-in-depth: DTO already validates, but compiler should too.
 * @throws Error if field is invalid
 */
export function validateSourceField(field: string): void {
  if (!VALID_SOURCE_FIELDS.has(field)) {
    throw new Error(
      `Invalid source field: ${field}. Allowed: ${[...VALID_SOURCE_FIELDS].join(', ')}`,
    );
  }
}

/**
 * Validate that a dimension is a valid writable dimension.
 * @throws Error if dimension is invalid
 */
export function validateDimension(dimension: string): void {
  if (!VALID_WRITABLE_DIMENSIONS.has(dimension)) {
    throw new Error(
      `Invalid dimension: ${dimension}. Allowed: ${[...VALID_WRITABLE_DIMENSIONS].join(', ')}`,
    );
  }
}

/**
 * Compile a single condition to ClickHouse SQL.
 */
export function compileCondition(c: FilterCondition): string {
  validateSourceField(c.field);
  const field = c.field;
  const value = escapeSQL(c.value);

  // Handle is_direct (boolean field stored as Bool in ClickHouse)
  if (field === 'is_direct') {
    if (c.operator === 'equals') {
      // Handle both string 'true'/'false' and boolean true/false (from JSON parsing)
      const boolValue =
        (c.value as unknown) === true || c.value === 'true' || c.value === '1';
      return `is_direct = ${boolValue ? 1 : 0}`;
    }
    // contains/regex don't make sense for boolean
    return '0 = 1';
  }

  // String fields - check non-empty first (schema uses DEFAULT '')
  switch (c.operator) {
    case 'equals':
      return `(${field} != '' AND ${field} = '${value}')`;

    case 'contains':
      return `(${field} != '' AND position(${field}, '${value}') > 0)`;

    case 'regex':
      return `(${field} != '' AND match(${field}, '${escapeRegex(c.value)}'))`;

    default:
      // Unknown operator, never matches
      return '0 = 1';
  }
}

/**
 * Compile multiple conditions with AND logic.
 */
export function compileConditions(conditions: FilterCondition[]): string {
  if (conditions.length === 0) {
    return '1 = 1'; // Always matches
  }
  return conditions.map(compileCondition).join(' AND ');
}

/**
 * Build a CASE expression for a dimension.
 */
export function buildCaseExpression(
  dimension: string,
  branches: CaseBranch[],
): string {
  const whenClauses = branches.map((b) => {
    let condition = b.conditionSQL;
    let thenValue: string;

    switch (b.action) {
      case 'set_value':
        thenValue = `'${escapeSQL(b.value!)}'`;
        break;

      case 'unset_value':
        // Use empty string for non-nullable String columns (schema uses DEFAULT '')
        thenValue = "''";
        break;

      case 'set_default_value':
        // Only set if dimension is currently empty
        condition = `${condition} AND (${dimension} = '' OR ${dimension} IS NULL)`;
        thenValue = `'${escapeSQL(b.value!)}'`;
        break;

      default:
        throw new Error(`Unknown action: ${b.action}`);
    }

    return `WHEN ${condition} THEN ${thenValue}`;
  });

  // ELSE preserves existing value (prevents data loss during backfill)
  return `CASE\n    ${whenClauses.join('\n    ')}\n    ELSE ${dimension}\n  END`;
}

/**
 * Compile filter definitions to ClickHouse SQL SET clause.
 *
 * This compiles the filter rules into a SQL SET clause that can be used
 * in an ALTER TABLE UPDATE statement. The output evaluates all filters
 * using CASE WHEN expressions, ordered by priority (highest first).
 *
 * @param filters - Array of filter definitions
 * @returns Compiled SET clause and filter version hash
 */
export function compileFiltersToSQL(
  filters: FilterDefinition[],
): CompiledFilters {
  // 1. Filter enabled, sort by priority DESC (higher priority = earlier CASE branch)
  const sorted = filters
    .filter((f) => f.enabled)
    .sort((a, b) => b.priority - a.priority);

  // 2. Group operations by target dimension
  const dimensionBranches = new Map<string, CaseBranch[]>();

  for (const filter of sorted) {
    const conditionSQL = compileConditions(filter.conditions);

    for (const op of filter.operations) {
      validateDimension(op.dimension);
      const branches = dimensionBranches.get(op.dimension) ?? [];
      branches.push({
        conditionSQL,
        action: op.action,
        value: op.value,
      });
      dimensionBranches.set(op.dimension, branches);
    }
  }

  // 3. Compute version hash for this filter configuration
  const version = computeFilterVersion(sorted);

  // 4. Build SET clauses for custom dimensions that have filters targeting them
  const setClauses: string[] = [];

  for (const dim of CUSTOM_DIMENSIONS) {
    const branches = dimensionBranches.get(dim);
    if (branches && branches.length > 0) {
      // Has filters targeting this dimension: use CASE WHEN
      setClauses.push(`${dim} = ${buildCaseExpression(dim, branches)}`);
    }
  }

  // 5. Build SET clauses for modified standard fields (utm_*, referrer_domain, is_direct)
  //    Standard fields preserve their original value if no filter matches (ELSE field)
  for (const [dim, branches] of dimensionBranches) {
    if (!CUSTOM_DIMENSIONS.includes(dim)) {
      // Standard field with filter operations
      if (dim === 'is_direct') {
        // is_direct is boolean, needs special handling
        setClauses.push(`${dim} = ${buildBooleanCaseExpression(branches)}`);
      } else {
        // Standard string fields: preserve original value if no filter matches
        setClauses.push(
          `${dim} = ${buildStandardFieldCaseExpression(dim, branches)}`,
        );
      }
    }
  }

  return {
    setClause: setClauses.join(',\n  '),
    filterVersion: version,
  };
}

/**
 * Build a CASE expression for standard string fields (utm_*, referrer_domain).
 * Unlike custom dimensions, standard fields preserve their original value
 * if no filter matches (ELSE field instead of ELSE NULL).
 */
function buildStandardFieldCaseExpression(
  dimension: string,
  branches: CaseBranch[],
): string {
  const whenClauses = branches.map((b) => {
    let condition = b.conditionSQL;
    let thenValue: string;

    switch (b.action) {
      case 'set_value':
        thenValue = `'${escapeSQL(b.value!)}'`;
        break;

      case 'unset_value':
        // Use empty string for non-nullable String columns (schema uses DEFAULT '')
        thenValue = "''";
        break;

      case 'set_default_value':
        // Only set if field is currently empty
        condition = `${condition} AND (${dimension} = '' OR ${dimension} IS NULL)`;
        thenValue = `'${escapeSQL(b.value!)}'`;
        break;

      default:
        throw new Error(`Unknown action: ${b.action}`);
    }

    return `WHEN ${condition} THEN ${thenValue}`;
  });

  // ELSE preserves original value for standard fields
  return `CASE\n    ${whenClauses.join('\n    ')}\n    ELSE ${dimension}\n  END`;
}

/**
 * Build a CASE expression for the is_direct boolean field.
 */
function buildBooleanCaseExpression(branches: CaseBranch[]): string {
  const whenClauses = branches.map((b) => {
    let condition = b.conditionSQL;
    let thenValue: string;

    switch (b.action) {
      case 'set_value':
        // Handle both string 'true'/'false' and boolean true/false (from JSON parsing)
        thenValue =
          (b.value as unknown) === true ||
          b.value === 'true' ||
          b.value === '1'
            ? '1'
            : '0';
        break;

      case 'unset_value':
        thenValue = '0'; // Default to false for boolean
        break;

      case 'set_default_value':
        condition = `${condition} AND is_direct = 0`;
        // Handle both string 'true'/'false' and boolean true/false (from JSON parsing)
        thenValue =
          (b.value as unknown) === true ||
          b.value === 'true' ||
          b.value === '1'
            ? '1'
            : '0';
        break;

      default:
        throw new Error(`Unknown action: ${b.action}`);
    }

    return `WHEN ${condition} THEN ${thenValue}`;
  });

  return `CASE\n    ${whenClauses.join('\n    ')}\n    ELSE is_direct\n  END`;
}
