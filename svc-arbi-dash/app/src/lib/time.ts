import { DateTime, Duration } from 'luxon';

export const LONDON_TZ = 'Europe/London';
const DATE_FMT = 'dd LLL yyyy, HH:mm:ss';

export function toLondonDateTime(ts: number): DateTime {
  return DateTime.fromMillis(ts, { zone: LONDON_TZ });
}

export function formatDateTime(ts: number): string {
  return toLondonDateTime(ts).toFormat(DATE_FMT);
}

export function formatDay(ts: number): string {
  return toLondonDateTime(ts).toFormat('dd LLL yyyy');
}

export function ukDayKey(ts: number): string {
  return toLondonDateTime(ts).toISODate();
}

export function parseUkDateTime(value: string): number {
  const dt = DateTime.fromFormat(value, 'yyyy-LL-dd HH:mm', { zone: LONDON_TZ });
  if (!dt.isValid) {
    throw new Error('Invalid date');
  }
  return dt.toUTC().toMillis();
}

export function parseUkDate(value: string): number {
  const dt = DateTime.fromFormat(value, 'yyyy-LL-dd', { zone: LONDON_TZ });
  if (!dt.isValid) {
    throw new Error('Invalid date');
  }
  return dt.toUTC().toMillis();
}

export function taxYearBounds(taxYear: string): { start: DateTime; end: DateTime } {
  const [startYearStr, endSuffix] = taxYear.split('-');
  if (!startYearStr || !endSuffix) {
    throw new Error('Tax year format must be YYYY-YY');
  }
  const startYear = Number.parseInt(startYearStr, 10);
  const endYear = Number.parseInt(startYearStr.slice(0, 2) + endSuffix, 10);
  const start = DateTime.fromObject({ year: startYear, month: 4, day: 6 }, { zone: LONDON_TZ, hour: 0, minute: 0, second: 0 });
  const end = DateTime.fromObject({ year: endYear, month: 4, day: 5, hour: 23, minute: 59, second: 59, millisecond: 999 }, { zone: LONDON_TZ });
  return { start, end };
}

export function addMinutes(ts: number, minutes: number): number {
  return toLondonDateTime(ts).plus({ minutes }).toMillis();
}

export function minutesBetween(a: number, b: number): number {
  return Math.abs(Duration.fromMillis(b - a).as('minutes'));
}

export function withinLastMinutes(sampleTs: number, nowTs: number, minutes: number): boolean {
  return nowTs - sampleTs <= minutes * 60 * 1000;
}
