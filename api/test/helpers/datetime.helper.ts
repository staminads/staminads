/**
 * DateTime helper functions for ClickHouse test data
 *
 * Provides consistent date/time formatting for ClickHouse inserts.
 */

// Re-export from shared utility
export {
  toClickHouseDateTime,
  parseClickHouseDateTime,
} from '../../src/common/utils/datetime.util';

// Keep test-specific helpers below

/**
 * Convert a Date to ClickHouse Date format (YYYY-MM-DD)
 *
 * @param date - Date to convert
 * @returns Formatted date string
 *
 * @example
 * toClickHouseDate(new Date('2024-01-15')) // '2024-01-15'
 */
export function toClickHouseDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get a date relative to now
 *
 * @param days - Number of days to add (negative for past)
 * @returns New Date object
 *
 * @example
 * daysFromNow(-7) // 7 days ago
 * daysFromNow(30) // 30 days from now
 */
export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Get a date relative to now in ClickHouse DateTime format
 *
 * @param days - Number of days to add (negative for past)
 * @returns Formatted datetime string
 */
export function daysFromNowClickHouse(days: number): string {
  return toClickHouseDateTime(daysFromNow(days));
}
