import { describe, it, expect } from 'vitest';
import { parseStmDimensions } from './stm-dimensions';

describe('parseStmDimensions', () => {
  describe('basic parsing', () => {
    it('parses single dimension (stm_1)', () => {
      const result = parseStmDimensions('https://example.com?stm_1=campaign_a');
      expect(result).toEqual({ 1: 'campaign_a' });
    });

    it('parses multiple dimensions', () => {
      const result = parseStmDimensions('https://example.com?stm_1=first&stm_5=fifth&stm_10=tenth');
      expect(result).toEqual({
        1: 'first',
        5: 'fifth',
        10: 'tenth',
      });
    });

    it('handles all indices 1-10', () => {
      const url = 'https://example.com?' +
        Array.from({ length: 10 }, (_, i) => `stm_${i + 1}=val${i + 1}`).join('&');
      const result = parseStmDimensions(url);

      expect(Object.keys(result)).toHaveLength(10);
      for (let i = 1; i <= 10; i++) {
        expect(result[i]).toBe(`val${i}`);
      }
    });

    it('returns empty object for URL without stm params', () => {
      const result = parseStmDimensions('https://example.com?utm_source=google');
      expect(result).toEqual({});
    });
  });

  describe('index validation', () => {
    it('ignores stm_0 (out of range)', () => {
      const result = parseStmDimensions('https://example.com?stm_0=invalid&stm_1=valid');
      expect(result).toEqual({ 1: 'valid' });
      expect(result[0]).toBeUndefined();
    });

    it('ignores stm_11 (out of range)', () => {
      const result = parseStmDimensions('https://example.com?stm_11=invalid&stm_10=valid');
      expect(result).toEqual({ 10: 'valid' });
      expect(result[11]).toBeUndefined();
    });

    it('ignores negative indices', () => {
      const result = parseStmDimensions('https://example.com?stm_-1=invalid&stm_1=valid');
      expect(result).toEqual({ 1: 'valid' });
    });
  });

  describe('value validation', () => {
    it('ignores values > 256 characters', () => {
      const longValue = 'a'.repeat(257);
      const result = parseStmDimensions(`https://example.com?stm_1=${longValue}&stm_2=valid`);
      expect(result).toEqual({ 2: 'valid' });
      expect(result[1]).toBeUndefined();
    });

    it('accepts values exactly 256 characters', () => {
      const exactValue = 'a'.repeat(256);
      const result = parseStmDimensions(`https://example.com?stm_1=${exactValue}`);
      expect(result).toEqual({ 1: exactValue });
    });

    it('handles empty string values', () => {
      const result = parseStmDimensions('https://example.com?stm_1=');
      expect(result).toEqual({ 1: '' });
    });
  });

  describe('URL encoding', () => {
    it('handles URL-encoded values', () => {
      const result = parseStmDimensions('https://example.com?stm_1=hello%20world');
      expect(result).toEqual({ 1: 'hello world' });
    });

    it('handles special characters', () => {
      const result = parseStmDimensions('https://example.com?stm_1=a%2Bb%3Dc');
      expect(result).toEqual({ 1: 'a+b=c' });
    });

    it('handles unicode characters', () => {
      const result = parseStmDimensions('https://example.com?stm_1=%E4%B8%AD%E6%96%87');
      expect(result).toEqual({ 1: '中文' });
    });
  });

  describe('error handling', () => {
    it('handles invalid URLs gracefully', () => {
      const result = parseStmDimensions('not-a-valid-url');
      expect(result).toEqual({});
    });

    it('handles empty string', () => {
      const result = parseStmDimensions('');
      expect(result).toEqual({});
    });

    it('handles URL without query string', () => {
      const result = parseStmDimensions('https://example.com/page');
      expect(result).toEqual({});
    });
  });

  describe('mixed parameters', () => {
    it('ignores non-stm parameters', () => {
      const result = parseStmDimensions(
        'https://example.com?utm_source=google&stm_1=dim1&fbclid=abc&stm_2=dim2'
      );
      expect(result).toEqual({ 1: 'dim1', 2: 'dim2' });
    });

    it('handles duplicate stm params (first value wins)', () => {
      const result = parseStmDimensions('https://example.com?stm_1=first&stm_1=second');
      expect(result).toEqual({ 1: 'first' });
    });
  });
});
