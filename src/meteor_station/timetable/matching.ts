/** Match the usable part of a satellite pass to the school's local bell times. */
import {
  SCHOOL_UTC_OFFSET_MINUTES,
  type Observer,
  type Pass,
  type ReceptionWindow,
} from '@meteor/core/models';
import { BELL_PERIODS, type BellPeriod } from '@meteor/timetable/school';
import { peakBetween, type Orbit } from '@meteor/orbit/propagation';
import { requireFinite, StationError } from '@meteor/core/errors';

/** Validate exclusion dates without normalizing impossible dates into another day. */
export function parseSchoolDates(input: string): string[] {
  const values = input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const day of values) {
    const time = Date.parse(`${day}T12:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== day
    ) {
      throw new StationError(
        'Use valid dates in YYYY-MM-DD format, separated by commas.',
      );
    }
  }
  return [...new Set(values)];
}

export interface MatchOptions {
  readonly setupMinutes: number;
  readonly packMinutes: number;
  readonly minimumMinutes: number;
  readonly allowedLessons: readonly string[];
  readonly excludedDates: readonly string[];
  readonly notBefore?: number;
}
export const DEFAULT_MATCH: MatchOptions = Object.freeze({
  setupMinutes: 5,
  packMinutes: 3,
  minimumMinutes: 3,
  allowedLessons: [],
  excludedDates: [],
});

export function schoolDate(at: number): string {
  return new Date(at + SCHOOL_UTC_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}
export function bellTimestamp(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+07:00`);
}
export function overlapWindow(
  pass: Pass,
  period: BellPeriod,
  day: string,
  options: MatchOptions,
): ReceptionWindow | null {
  requireFinite(options.setupMinutes, 'Setup minutes', 0, 30);
  requireFinite(options.packMinutes, 'Pack-away minutes', 0, 30);
  requireFinite(options.minimumMinutes, 'Minimum reception', 1, 20);
  const from = bellTimestamp(day, period.from);
  const until = bellTimestamp(day, period.until);
  const receiveFrom = Math.max(
    pass.start,
    Math.max(from, options.notBefore ?? from) + options.setupMinutes * 60000,
  );
  const receiveUntil = Math.min(pass.end, until - options.packMinutes * 60000);
  const usableMinutes = (receiveUntil - receiveFrom) / 60000;
  if (usableMinutes < options.minimumMinutes) return null;
  return Object.freeze({
    pass,
    label: period.label,
    kind: period.kind,
    setupAt: receiveFrom - options.setupMinutes * 60000,
    receiveFrom,
    receiveUntil,
    packedBy: receiveUntil + options.packMinutes * 60000,
    usableMinutes,
    maxElevation: pass.maxElevation,
    completePass:
      !pass.clippedStart &&
      !pass.clippedEnd &&
      receiveFrom <= pass.start &&
      receiveUntil >= pass.end,
  });
}

export function matchPasses(
  passes: readonly Pass[],
  orbits: readonly Orbit[],
  observer: Observer,
  options = DEFAULT_MATCH,
): ReceptionWindow[] {
  const windows: ReceptionWindow[] = [];
  for (const pass of passes) {
    const day = schoolDate(pass.start);
    const weekday = new Date(`${day}T12:00:00+07:00`).getUTCDay();
    if (weekday === 0 || weekday === 6 || options.excludedDates.includes(day)) continue;
    for (const period of BELL_PERIODS) {
      if (period.kind === 'lesson' && !options.allowedLessons.includes(period.id))
        continue;
      const window = overlapWindow(pass, period, day, options);
      if (!window) continue;
      const orbit = orbits.find((item) => item.norad === pass.norad)!;
      const peak = peakBetween(
        orbit,
        observer,
        window.receiveFrom,
        window.receiveUntil,
      );
      windows.push(Object.freeze({ ...window, maxElevation: peak.elevation }));
    }
  }
  return windows.sort((a, b) => {
    const dateOrder = schoolDate(a.receiveFrom).localeCompare(
      schoolDate(b.receiveFrom),
    );
    if (dateOrder !== 0) return dateOrder;
    if (a.kind !== b.kind) return a.kind === 'break' ? -1 : 1;
    return (
      (b.completePass ? 1 : 0) - (a.completePass ? 1 : 0) ||
      b.maxElevation - a.maxElevation ||
      b.usableMinutes - a.usableMinutes
    );
  });
}
