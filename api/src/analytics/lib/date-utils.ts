import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(quarterOfYear);
dayjs.extend(isoWeek);

export interface ResolvedDateRange {
  start: string;
  end: string;
}

/**
 * Shift a date preset to its previous period.
 * For example, if last_7_days resolves to Dec 8-14, this returns Dec 1-7.
 */
export function shiftPresetToPreviousPeriod(
  preset: string,
  tz: string,
): ResolvedDateRange {
  const current = resolveDatePreset(preset, tz);
  const duration = dayjs(current.end).diff(dayjs(current.start), 'day') + 1;

  return {
    start: dayjs(current.start).subtract(duration, 'day').toISOString(),
    end: dayjs(current.end).subtract(duration, 'day').toISOString(),
  };
}

export function resolveDatePreset(
  preset: string,
  tz: string,
): ResolvedDateRange {
  const now = dayjs().tz(tz);

  switch (preset) {
    case 'previous_30_minutes':
      return {
        start: now.subtract(30, 'minute').toISOString(),
        end: now.toISOString(),
      };
    case 'today':
      return {
        start: now.startOf('day').toISOString(),
        end: now.endOf('day').toISOString(),
      };
    case 'yesterday': {
      const yesterday = now.subtract(1, 'day');
      return {
        start: yesterday.startOf('day').toISOString(),
        end: yesterday.endOf('day').toISOString(),
      };
    }
    case 'previous_7_days':
      return {
        start: now.subtract(7, 'day').startOf('day').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'previous_14_days':
      return {
        start: now.subtract(14, 'day').startOf('day').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'previous_28_days':
      return {
        start: now.subtract(28, 'day').startOf('day').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'previous_30_days':
      return {
        start: now.subtract(30, 'day').startOf('day').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'previous_90_days':
      return {
        start: now.subtract(90, 'day').startOf('day').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'previous_91_days':
      return {
        start: now.subtract(91, 'day').startOf('day').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'this_week':
      return {
        start: now.startOf('isoWeek').toISOString(),
        end: now.endOf('day').toISOString(),
      };
    case 'previous_week': {
      const previousWeek = now.subtract(1, 'week');
      return {
        start: previousWeek.startOf('isoWeek').toISOString(),
        end: previousWeek.endOf('isoWeek').toISOString(),
      };
    }
    case 'this_month':
      return {
        start: now.startOf('month').toISOString(),
        end: now.endOf('day').toISOString(),
      };
    case 'previous_month': {
      const previousMonth = now.subtract(1, 'month');
      return {
        start: previousMonth.startOf('month').toISOString(),
        end: previousMonth.endOf('month').toISOString(),
      };
    }
    case 'this_quarter':
      return {
        start: now.startOf('quarter').toISOString(),
        end: now.endOf('day').toISOString(),
      };
    case 'previous_quarter': {
      const previousQuarter = now.subtract(1, 'quarter');
      return {
        start: previousQuarter.startOf('quarter').toISOString(),
        end: previousQuarter.endOf('quarter').toISOString(),
      };
    }
    case 'this_year':
      return {
        start: now.startOf('year').toISOString(),
        end: now.endOf('day').toISOString(),
      };
    case 'previous_year': {
      const previousYear = now.subtract(1, 'year');
      return {
        start: previousYear.startOf('year').toISOString(),
        end: previousYear.endOf('year').toISOString(),
      };
    }
    case 'previous_12_months':
      return {
        start: now.subtract(12, 'month').startOf('month').toISOString(),
        end: now.subtract(1, 'day').endOf('day').toISOString(),
      };
    case 'all_time':
      return {
        start: dayjs('2020-01-01').startOf('day').toISOString(),
        end: now.endOf('day').toISOString(),
      };
    default:
      throw new Error(`Unknown date preset: ${preset}`);
  }
}

/**
 * Fill gaps in time series data with zeros.
 * Handles both pure time series and time series with dimensions.
 */
export function fillGaps<T extends Record<string, unknown>>(
  data: T[],
  granularity: string,
  dateColumn: string,
  start: string,
  end: string,
  metrics: string[],
  dimensions: string[] = [],
  tz: string = 'UTC',
): T[] {
  // Determine date format and unit based on granularity
  let dateFormat: string;
  let unit: dayjs.ManipulateType;

  switch (granularity) {
    case 'hour':
      dateFormat = 'YYYY-MM-DD HH:00:00';
      unit = 'hour';
      break;
    case 'day':
      dateFormat = 'YYYY-MM-DD';
      unit = 'day';
      break;
    case 'week':
      dateFormat = 'YYYY-MM-DD';
      unit = 'week';
      break;
    case 'month':
      dateFormat = 'YYYY-MM-01';
      unit = 'month';
      break;
    case 'year':
      dateFormat = 'YYYY-01-01';
      unit = 'year';
      break;
    default:
      dateFormat = 'YYYY-MM-DD';
      unit = 'day';
  }

  // Generate all dates in range
  // Dates are stored in UTC format, convert to workspace timezone for correct day boundaries
  const allDates: string[] = [];
  let current = dayjs.utc(start).tz(tz);
  const endDate = dayjs.utc(end).tz(tz);
  while (current.isBefore(endDate) || current.isSame(endDate, unit)) {
    allDates.push(current.format(dateFormat));
    current = current.add(1, unit);
  }

  // If no dimensions, simple gap filling
  if (dimensions.length === 0) {
    const dataMap = new Map<string, T>();
    for (const row of data) {
      const dateValue = row[dateColumn] as string;
      const key = dayjs(dateValue).format(dateFormat);
      dataMap.set(key, row);
    }

    return allDates.map((date) => {
      if (dataMap.has(date)) return dataMap.get(date)!;
      const zeroRow = { [dateColumn]: date } as T;
      for (const metric of metrics) {
        (zeroRow as Record<string, unknown>)[metric] = 0;
      }
      return zeroRow;
    });
  }

  // With dimensions: find unique dimension combinations and fill gaps for each
  const dimensionCombos = new Set<string>();
  const dataMap = new Map<string, T>(); // key = "date|dim1|dim2|..."

  for (const row of data) {
    const dateKey = dayjs(row[dateColumn] as string).format(dateFormat);
    const dimValues = dimensions.map((d) => {
      const val = row[d];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
    const comboKey = dimValues.join('|');
    dimensionCombos.add(comboKey);
    dataMap.set(`${dateKey}|${comboKey}`, row);
  }

  // Generate all date × dimension combinations
  const result: T[] = [];
  for (const date of allDates) {
    for (const combo of dimensionCombos) {
      const key = `${date}|${combo}`;
      if (dataMap.has(key)) {
        result.push(dataMap.get(key)!);
      } else {
        // Create zero-filled row with dimension values
        const dimValues = combo.split('|');
        const zeroRow = { [dateColumn]: date } as T;
        dimensions.forEach((dim, i) => {
          (zeroRow as Record<string, unknown>)[dim] = dimValues[i];
        });
        for (const metric of metrics) {
          (zeroRow as Record<string, unknown>)[metric] = 0;
        }
        result.push(zeroRow);
      }
    }
  }

  return result;
}
