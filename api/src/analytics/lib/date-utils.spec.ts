import {
  resolveDatePreset,
  fillGaps,
  shiftPresetToPreviousPeriod,
} from './date-utils';
import dayjs from 'dayjs';

describe('resolveDatePreset', () => {
  const tz = 'UTC';

  // Use a fixed date for testing to avoid flaky tests
  const mockNow = new Date('2025-12-15T12:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(mockNow);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('resolves today', () => {
    const result = resolveDatePreset('today', tz);
    expect(result.start).toContain('2025-12-15');
    expect(result.end).toContain('2025-12-15');
  });

  it('resolves yesterday', () => {
    const result = resolveDatePreset('yesterday', tz);
    expect(result.start).toContain('2025-12-14');
    expect(result.end).toContain('2025-12-14');
  });

  it('resolves last_7_days', () => {
    const result = resolveDatePreset('last_7_days', tz);
    // Dec 15 - 7 = Dec 8, ends at Dec 14 (yesterday)
    expect(result.start).toContain('2025-12-08');
    expect(result.end).toContain('2025-12-14');
  });

  it('resolves last_14_days', () => {
    const result = resolveDatePreset('last_14_days', tz);
    // Dec 15 - 14 = Dec 1, ends at Dec 14 (yesterday)
    expect(result.start).toContain('2025-12-01');
    expect(result.end).toContain('2025-12-14');
  });

  it('resolves last_30_days', () => {
    const result = resolveDatePreset('last_30_days', tz);
    // Dec 15 - 30 = Nov 15, ends at Dec 14 (yesterday)
    expect(result.start).toContain('2025-11-15');
    expect(result.end).toContain('2025-12-14');
  });

  it('resolves last_90_days', () => {
    const result = resolveDatePreset('last_90_days', tz);
    // Dec 15 - 90 = Sep 16, ends at Dec 14 (yesterday)
    expect(result.start).toContain('2025-09-16');
    expect(result.end).toContain('2025-12-14');
  });

  it('resolves this_week (Monday start)', () => {
    const result = resolveDatePreset('this_week', tz);
    // Dec 15 is Monday, so start is Dec 15
    expect(result.start).toContain('2025-12-15');
    expect(result.end).toContain('2025-12-15');
  });

  it('resolves last_week', () => {
    const result = resolveDatePreset('last_week', tz);
    // Week before Dec 15: Dec 8 (Mon) to Dec 14 (Sun)
    expect(result.start).toContain('2025-12-08');
    expect(result.end).toContain('2025-12-14');
  });

  it('resolves this_month', () => {
    const result = resolveDatePreset('this_month', tz);
    expect(result.start).toContain('2025-12-01');
    expect(result.end).toContain('2025-12-15');
  });

  it('resolves last_month', () => {
    const result = resolveDatePreset('last_month', tz);
    expect(result.start).toContain('2025-11-01');
    expect(result.end).toContain('2025-11-30');
  });

  it('resolves this_quarter (Q4)', () => {
    const result = resolveDatePreset('this_quarter', tz);
    // Q4 starts Oct 1
    expect(result.start).toContain('2025-10-01');
    expect(result.end).toContain('2025-12-15');
  });

  it('resolves last_quarter (Q3)', () => {
    const result = resolveDatePreset('last_quarter', tz);
    // Q3: Jul 1 to Sep 30
    expect(result.start).toContain('2025-07-01');
    expect(result.end).toContain('2025-09-30');
  });

  it('resolves this_year', () => {
    const result = resolveDatePreset('this_year', tz);
    expect(result.start).toContain('2025-01-01');
    expect(result.end).toContain('2025-12-15');
  });

  it('resolves last_year', () => {
    const result = resolveDatePreset('last_year', tz);
    expect(result.start).toContain('2024-01-01');
    expect(result.end).toContain('2024-12-31');
  });

  it('throws for unknown preset', () => {
    expect(() => resolveDatePreset('invalid_preset', tz)).toThrow(
      'Unknown date preset: invalid_preset',
    );
  });
});

describe('fillGaps', () => {
  it('fills missing dates with zeros', () => {
    const data = [
      { date_day: '2025-12-01', sessions: 100 },
      { date_day: '2025-12-03', sessions: 150 },
    ];
    const result = fillGaps(
      data,
      'day',
      'date_day',
      '2025-12-01',
      '2025-12-03',
      ['sessions'],
    );

    expect(result).toHaveLength(3);
    expect(result[0].date_day).toBe('2025-12-01');
    expect(result[0].sessions).toBe(100);
    expect(result[1].date_day).toBe('2025-12-02');
    expect(result[1].sessions).toBe(0);
    expect(result[2].date_day).toBe('2025-12-03');
    expect(result[2].sessions).toBe(150);
  });

  it('preserves existing data with multiple metrics', () => {
    const data = [
      { date_day: '2025-12-01', sessions: 100, avg_duration: 45.5 },
    ];
    const result = fillGaps(
      data,
      'day',
      'date_day',
      '2025-12-01',
      '2025-12-02',
      ['sessions', 'avg_duration'],
    );

    expect(result).toHaveLength(2);
    expect(result[0].sessions).toBe(100);
    expect(result[0].avg_duration).toBe(45.5);
    expect(result[1].sessions).toBe(0);
    expect(result[1].avg_duration).toBe(0);
  });

  it('handles empty data', () => {
    const result = fillGaps<{ date_day: string; sessions: number }>(
      [],
      'day',
      'date_day',
      '2025-12-01',
      '2025-12-03',
      ['sessions'],
    );
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.sessions === 0)).toBe(true);
  });

  it('handles week granularity', () => {
    const data = [{ date_week: '2025-12-01', sessions: 100 }];
    const result = fillGaps(
      data,
      'week',
      'date_week',
      '2025-12-01',
      '2025-12-15',
      ['sessions'],
    );
    expect(result).toHaveLength(3); // 3 weeks
  });

  it('handles month granularity', () => {
    const data = [{ date_month: '2025-10-01', sessions: 100 }];
    const result = fillGaps(
      data,
      'month',
      'date_month',
      '2025-10-01',
      '2025-12-01',
      ['sessions'],
    );
    expect(result).toHaveLength(3); // Oct, Nov, Dec
  });

  it('handles hour granularity', () => {
    const data = [{ date_hour: '2025-12-01 10:00:00', sessions: 100 }];
    const result = fillGaps(
      data,
      'hour',
      'date_hour',
      '2025-12-01T10:00:00',
      '2025-12-01T12:00:00',
      ['sessions'],
    );
    expect(result).toHaveLength(3); // 10:00, 11:00, 12:00
  });

  it('preserves dimension values', () => {
    const data = [
      { date_day: '2025-12-01', utm_source: 'google', sessions: 100 },
    ];
    const result = fillGaps(
      data,
      'day',
      'date_day',
      '2025-12-01',
      '2025-12-01',
      ['sessions'],
    );
    expect(result[0].utm_source).toBe('google');
  });

  it('fills gaps for each dimension combination', () => {
    const data = [
      { date_day: '2025-12-01', device: 'mobile', sessions: 50 },
      { date_day: '2025-12-01', device: 'desktop', sessions: 50 },
      { date_day: '2025-12-03', device: 'mobile', sessions: 75 },
    ];
    const result = fillGaps(
      data,
      'day',
      'date_day',
      '2025-12-01',
      '2025-12-03',
      ['sessions'],
      ['device'],
    );

    expect(result).toHaveLength(6); // 3 days × 2 devices
    const dec2Mobile = result.find(
      (r) => r.date_day === '2025-12-02' && r.device === 'mobile',
    );
    expect(dec2Mobile?.sessions).toBe(0);
    const dec2Desktop = result.find(
      (r) => r.date_day === '2025-12-02' && r.device === 'desktop',
    );
    expect(dec2Desktop?.sessions).toBe(0);
    // Dec 3 desktop should be 0 (only mobile has data)
    const dec3Desktop = result.find(
      (r) => r.date_day === '2025-12-03' && r.device === 'desktop',
    );
    expect(dec3Desktop?.sessions).toBe(0);
  });

  it('fills gaps for multiple dimensions', () => {
    const data = [
      {
        date_day: '2025-12-01',
        device: 'mobile',
        utm_source: 'google',
        sessions: 25,
      },
      {
        date_day: '2025-12-01',
        device: 'desktop',
        utm_source: 'facebook',
        sessions: 30,
      },
    ];
    const result = fillGaps(
      data,
      'day',
      'date_day',
      '2025-12-01',
      '2025-12-02',
      ['sessions'],
      ['device', 'utm_source'],
    );

    // 2 days × 2 dimension combos = 4 rows
    expect(result).toHaveLength(4);
    const dec2MobileGoogle = result.find(
      (r) =>
        r.date_day === '2025-12-02' &&
        r.device === 'mobile' &&
        r.utm_source === 'google',
    );
    expect(dec2MobileGoogle?.sessions).toBe(0);
  });
});

describe('shiftPresetToPreviousPeriod', () => {
  const tz = 'UTC';

  // Use a fixed date for testing
  const mockNow = new Date('2025-12-15T12:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(mockNow);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('shifts last_7_days to previous 7 days', () => {
    const result = shiftPresetToPreviousPeriod('last_7_days', tz);
    // last_7_days = Dec 8-14, shifted = Dec 1-7
    expect(dayjs(result.end).diff(dayjs(result.start), 'day')).toBe(6);
    expect(result.start).toContain('2025-12-01');
    expect(result.end).toContain('2025-12-07');
  });

  it('shifts last_14_days to previous 14 days', () => {
    const result = shiftPresetToPreviousPeriod('last_14_days', tz);
    // last_14_days = Dec 1-14, shifted = Nov 17-30
    expect(dayjs(result.end).diff(dayjs(result.start), 'day')).toBe(13);
    expect(result.start).toContain('2025-11-17');
    expect(result.end).toContain('2025-11-30');
  });

  it('shifts last_30_days to previous 30 days', () => {
    const result = shiftPresetToPreviousPeriod('last_30_days', tz);
    // last_30_days = Nov 15 - Dec 14, shifted = Oct 16 - Nov 14
    expect(dayjs(result.end).diff(dayjs(result.start), 'day')).toBe(29);
  });

  it('preserves duration when shifting', () => {
    const current = resolveDatePreset('last_7_days', tz);
    const shifted = shiftPresetToPreviousPeriod('last_7_days', tz);
    const currentDuration = dayjs(current.end).diff(
      dayjs(current.start),
      'day',
    );
    const shiftedDuration = dayjs(shifted.end).diff(
      dayjs(shifted.start),
      'day',
    );
    expect(shiftedDuration).toBe(currentDuration);
  });
});
