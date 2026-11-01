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
  /** Testing mode: ignore bell times and weekends; excluded dates still apply. */
  readonly anyTime?: boolean;
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
  return windowBetween(
    pass,
    bellTimestamp(day, period.from),
    bellTimestamp(day, period.until),
    period.label,
    period.kind,
    options,
  );
}

/** Join continuous availability before reserving setup and pack-away time. */
export function schoolWindows(
  pass: Pass,
  day: string,
  options: MatchOptions,
  periods: readonly BellPeriod[] = BELL_PERIODS,
): ReceptionWindow[] {
  const eligible = periods
    .filter(
      (period) => period.kind === 'break' || options.allowedLessons.includes(period.id),
    )
    .map((period) => ({
      period,
      from: bellTimestamp(day, period.from),
      until: bellTimestamp(day, period.until),
    }))
    .sort((a, b) => a.from - b.from || a.until - b.until);
  const blocks: {
    from: number;
    until: number;
    periods: typeof eligible;
  }[] = [];
  for (const period of eligible) {
    const previous = blocks.at(-1);
    if (previous && period.from <= previous.until) {
      previous.until = Math.max(previous.until, period.until);
      previous.periods.push(period);
    } else {
      blocks.push({ from: period.from, until: period.until, periods: [period] });
    }
  }
  const windows: ReceptionWindow[] = [];
  for (const block of blocks) {
    const window = windowBetween(pass, block.from, block.until, '', 'lesson', options);
    if (!window) continue;
    // Name only periods actually needed, including setup and packing. A session
    // wholly inside lunch remains a break even when adjacent lessons are enabled.
    const used = block.periods.filter(
      (period) => period.from < window.packedBy && period.until > window.setupAt,
    );
    windows.push(
      Object.freeze({
        ...window,
        label: used.map(({ period }) => period.label).join(' + '),
        kind: used.some(({ period }) => period.kind === 'lesson') ? 'lesson' : 'break',
      }),
    );
  }
  return windows;
}

/** The whole pass, still reserving setup time before it and pack-away time after. */
export function anyTimeWindow(
  pass: Pass,
  options: MatchOptions,
): ReceptionWindow | null {
  return windowBetween(pass, -Infinity, Infinity, 'Any time', 'outside', options);
}
function windowBetween(
  pass: Pass,
  from: number,
  until: number,
  label: string,
  kind: ReceptionWindow['kind'],
  options: MatchOptions,
): ReceptionWindow | null {
  requireFinite(options.setupMinutes, 'Setup minutes', 0, 30);
  requireFinite(options.packMinutes, 'Pack-away minutes', 0, 30);
  requireFinite(options.minimumMinutes, 'Minimum reception', 1, 20);
  const receiveFrom = Math.max(
    pass.start,
    Math.max(from, options.notBefore ?? from) + options.setupMinutes * 60000,
  );
  const receiveUntil = Math.min(pass.end, until - options.packMinutes * 60000);
  const usableMinutes = (receiveUntil - receiveFrom) / 60000;
  if (usableMinutes < options.minimumMinutes) return null;
  return Object.freeze({
    pass,
    label,
    kind,
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
    if (options.excludedDates.includes(day)) continue;
    if (!options.anyTime && (weekday === 0 || weekday === 6)) continue;
    const candidates = options.anyTime
      ? [anyTimeWindow(pass, options)]
      : schoolWindows(pass, day, options);
    for (const window of candidates) {
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
  if (options.anyTime) return windows.sort((a, b) => a.receiveFrom - b.receiveFrom);
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

/** Match a recalculated passage without relying on rounded rise-time IDs. */
export function preserveReceptionWindow(
  previous: ReceptionWindow | null,
  windows: readonly ReceptionWindow[],
): ReceptionWindow | null {
  if (!previous) return null;
  const overlap = (window: ReceptionWindow): number =>
    Math.min(window.receiveUntil, previous.receiveUntil) -
    Math.max(window.receiveFrom, previous.receiveFrom);
  const sameAvailability = (window: ReceptionWindow): number =>
    Number(window.kind === previous.kind && window.label === previous.label);
  const timeChange = (window: ReceptionWindow): number =>
    Math.abs(window.receiveFrom - previous.receiveFrom) +
    Math.abs(window.receiveUntil - previous.receiveUntil);
  return (
    windows
      .filter(
        (window) =>
          window.pass.norad === previous.pass.norad &&
          window.pass.start < previous.pass.end &&
          window.pass.end > previous.pass.start &&
          overlap(window) > 0,
      )
      .sort(
        (a, b) =>
          sameAvailability(b) - sameAvailability(a) ||
          overlap(b) - overlap(a) ||
          timeChange(a) - timeChange(b),
      )[0] ?? null
  );
}
