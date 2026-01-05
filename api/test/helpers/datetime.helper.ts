/**
 * DateTime helper functions for ClickHouse test data
 *
 * Provides consistent date/time formatting for ClickHouse inserts.
 */

/**
 * Convert a Date to ClickHouse DateTime format (YYYY-MM-DD HH:MM:SS)
 *
 * @param date - Date to convert (defaults to now)
 * @returns Formatted datetime string
 *
 * @example
 * toClickHouseDateTime() // '2024-01-15 10:30:45'
 * toClickHouseDateTime(new Date('2024-01-01')) // '2024-01-01 00:00:00'
 */
export function toClickHouseDateTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

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
