import {
  parseClickHouseDateTime,
  toClickHouseDateTime,
  isoToClickHouseDateTime,
} from './datetime.util';

describe('datetime.util', () => {
  describe('parseClickHouseDateTime', () => {
    it('parses standard ClickHouse DateTime64(3) format', () => {
      const result = parseClickHouseDateTime('2024-01-15 10:30:45.123');
      expect(result.toISOString()).toBe('2024-01-15T10:30:45.123Z');
    });

    it('handles dates without milliseconds', () => {
      const result = parseClickHouseDateTime('2024-01-15 10:30:45');
      expect(result.toISOString()).toBe('2024-01-15T10:30:45.000Z');
    });

    it('parses edge case midnight', () => {
      const result = parseClickHouseDateTime('2024-01-01 00:00:00.000');
      expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('parses end of day', () => {
      const result = parseClickHouseDateTime('2024-12-31 23:59:59.999');
      expect(result.toISOString()).toBe('2024-12-31T23:59:59.999Z');
    });
  });

  describe('toClickHouseDateTime', () => {
    it('converts Date to ClickHouse format', () => {
      const date = new Date('2024-01-15T10:30:45.123Z');
      const result = toClickHouseDateTime(date);
      expect(result).toBe('2024-01-15 10:30:45.123');
    });

    it('uses current time when no argument provided', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));

      const result = toClickHouseDateTime();
      expect(result).toBe('2024-06-15 12:00:00.000');

      jest.useRealTimers();
    });

    it('preserves milliseconds', () => {
      const date = new Date('2024-01-15T10:30:45.001Z');
      const result = toClickHouseDateTime(date);
      expect(result).toBe('2024-01-15 10:30:45.001');
    });
  });

  describe('isoToClickHouseDateTime', () => {
    it('converts ISO string to ClickHouse format', () => {
      const result = isoToClickHouseDateTime('2024-01-15T10:30:45.123Z');
      expect(result).toBe('2024-01-15 10:30:45.123');
    });

    it('returns null for null input', () => {
      expect(isoToClickHouseDateTime(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(isoToClickHouseDateTime(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(isoToClickHouseDateTime('')).toBeNull();
    });
  });

  describe('roundtrip conversion', () => {
    it('parseClickHouseDateTime reverses toClickHouseDateTime', () => {
      const original = new Date('2024-06-15T14:30:00.500Z');
      const clickhouse = toClickHouseDateTime(original);
      const parsed = parseClickHouseDateTime(clickhouse);
      expect(parsed.getTime()).toBe(original.getTime());
    });
  });
});
