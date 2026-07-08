/**
 * Numeric sanitizers for values that must fit ClickHouse integer column types.
 *
 * The tracking payload is client-supplied, so device metrics like screen and
 * viewport dimensions can arrive negative, fractional, out of range, or NaN
 * (weird in-app browsers, bots, spoofed payloads). ClickHouse rejects such
 * values on insert (e.g. "Unsigned type must not contain '-' symbol"), and
 * because events are inserted in batches, a single bad value fails the entire
 * flush and drops unrelated events. Clamp at the boundary instead.
 */

const UINT16_MAX = 65535;

/**
 * Coerce an arbitrary value to a valid ClickHouse UInt16 (0..65535).
 * Non-finite, negative, and out-of-range values are clamped; fractions floored.
 */
export function toUInt16(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= UINT16_MAX) return UINT16_MAX;
  return Math.floor(n);
}
