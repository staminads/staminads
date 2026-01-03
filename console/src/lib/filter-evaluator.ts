import type { FilterCondition, FilterOperation, Filter } from '../types/filters'

/**
 * Evaluate a single condition against test values
 */
function evaluateCondition(
  condition: FilterCondition,
  testValues: Record<string, string | null>
): boolean {
  const testValue = testValues[condition.field] ?? ''
  const conditionValue = condition.value ?? ''

  switch (condition.operator) {
    case 'equals':
      return testValue === conditionValue
    case 'not_equals':
      return testValue !== '' && testValue !== conditionValue
    case 'contains':
      return testValue.includes(conditionValue)
    case 'not_contains':
      return testValue !== '' && !testValue.includes(conditionValue)
    case 'is_empty':
      return testValue === '' || testValue === null
    case 'is_not_empty':
      return testValue !== '' && testValue !== null
    case 'regex':
      try {
        return new RegExp(conditionValue).test(testValue)
      } catch {
        return false
      }
    default:
      return false
  }
}

/**
 * Evaluate all conditions (AND logic)
 */
export function evaluateConditions(
  conditions: FilterCondition[],
  testValues: Record<string, string | null>
): boolean {
  if (conditions.length === 0) return true // No conditions = always matches
  return conditions.every((c) => evaluateCondition(c, testValues))
}

/**
 * Simulate operation results
 */
export function simulateOperations(
  operations: FilterOperation[],
  matches: boolean
): Array<{ dimension: string; action: string; resultValue: string | null }> {
  return operations.map((op) => {
    let resultValue: string | null = null

    if (matches) {
      switch (op.action) {
        case 'set_value':
          resultValue = op.value ?? null
          break
        case 'unset_value':
          resultValue = null
          break
        case 'set_default_value':
          // For testing, assume dimension is currently null
          resultValue = op.value ?? null
          break
      }
    }

    return {
      dimension: op.dimension,
      action: op.action,
      resultValue,
    }
  })
}

/**
 * Test a single filter against test values
 */
export function testFilter(
  filter: Filter,
  testValues: Record<string, string | null>
): {
  matches: boolean
  operationResults: Array<{ dimension: string; action: string; resultValue: string | null }>
} {
  const matches = evaluateConditions(filter.conditions, testValues)
  const operationResults = simulateOperations(filter.operations, matches)
  return { matches, operationResults }
}

/**
 * Test all filters against test values, return matching filters sorted by priority
 */
export function testAllFilters(
  filters: Filter[],
  testValues: Record<string, string | null>
): Array<{
  filter: Filter
  matches: boolean
  operationResults: Array<{ dimension: string; action: string; resultValue: string | null }>
}> {
  return filters
    .map((filter) => ({
      filter,
      ...testFilter(filter, testValues),
    }))
    .sort((a, b) => b.filter.priority - a.filter.priority)
}
