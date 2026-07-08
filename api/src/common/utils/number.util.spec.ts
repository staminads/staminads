import { toUInt16 } from './number.util';

describe('number.util', () => {
  describe('toUInt16', () => {
    it('passes valid values through', () => {
      expect(toUInt16(0)).toBe(0);
      expect(toUInt16(1920)).toBe(1920);
      expect(toUInt16(65535)).toBe(65535);
    });

    it('clamps negative values to 0 (the reported ClickHouse crash)', () => {
      expect(toUInt16(-1)).toBe(0);
      expect(toUInt16(-9999)).toBe(0);
    });

    it('clamps out-of-range values to the UInt16 max', () => {
      expect(toUInt16(65536)).toBe(65535);
      expect(toUInt16(1_000_000)).toBe(65535);
    });

    it('floors fractional values', () => {
      expect(toUInt16(1920.7)).toBe(1920);
    });

    it('returns 0 for null, undefined, NaN, Infinity and non-numeric input', () => {
      expect(toUInt16(null)).toBe(0);
      expect(toUInt16(undefined)).toBe(0);
      expect(toUInt16(NaN)).toBe(0);
      expect(toUInt16(Infinity)).toBe(0);
      expect(toUInt16(-Infinity)).toBe(0);
      expect(toUInt16('abc')).toBe(0);
    });

    it('coerces numeric strings', () => {
      expect(toUInt16('1024')).toBe(1024);
    });
  });
});
