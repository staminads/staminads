/**
 * Converts a Date to ClickHouse DateTime64(3) format.
 * Format: YYYY-MM-DD HH:MM:SS.SSS
 */
export function toClickHouseDateTime(date: Date = new Date()): string {
  // ClickHouse DateTime64(3) expects format: YYYY-MM-DD HH:MM:SS.SSS
  // Keep milliseconds and ensure UTC timezone
  return date.toISOString().replace('T', ' ').slice(0, -1); // Remove trailing 'Z'
}

/**
 * Converts an ISO string to ClickHouse DateTime64(3) format.
 * Returns null if input is null/undefined.
 */
export function isoToClickHouseDateTime(
  isoString: string | null | undefined,
): string | null {
  if (!isoString) return null;
  // ClickHouse DateTime64(3) expects format: YYYY-MM-DD HH:MM:SS.SSS
  return isoString.replace('T', ' ').slice(0, -1); // Remove trailing 'Z', keep milliseconds
}

/**
 * Parses a ClickHouse DateTime64(3) string back to a Date object.
 */
export function parseClickHouseDateTime(datetime: string): Date {
  return new Date(datetime.replace(' ', 'T') + 'Z');
}
