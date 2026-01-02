/**
 * UUID generation utilities
 */

/**
 * Generate a UUIDv4
 */
export function generateUUIDv4(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a UUIDv7 (time-sortable)
 * Format: timestamp (48 bits) + version (4 bits) + random (12 bits) + variant (2 bits) + random (62 bits)
 */
export function generateUUIDv7(): string {
  const timestamp = Date.now();

  // Convert timestamp to hex (48 bits = 12 hex chars)
  const timestampHex = timestamp.toString(16).padStart(12, '0');

  // Generate random bytes
  let randomHex: string;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const randomBytes = new Uint8Array(10);
    crypto.getRandomValues(randomBytes);
    randomHex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Fallback
    randomHex = Array.from({ length: 20 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  // Build UUIDv7
  // Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
  const uuid = [
    timestampHex.slice(0, 8), // First 8 hex chars of timestamp
    timestampHex.slice(8, 12), // Next 4 hex chars
    '7' + randomHex.slice(0, 3), // Version 7 + 3 random hex
    ((parseInt(randomHex.slice(3, 4), 16) & 0x3) | 0x8).toString(16) +
      randomHex.slice(4, 7), // Variant + 3 random hex
    randomHex.slice(7, 19), // 12 random hex chars
  ].join('-');

  return uuid;
}
