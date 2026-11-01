import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MATCH,
  anyTimeWindow,
  bellTimestamp,
  matchPasses,
  overlapWindow,
  preserveReceptionWindow,
  schoolWindows,
} from '@meteor/timetable/matching';
import { BELL_PERIODS, type BellPeriod } from '@meteor/timetable/school';
import { SUNRISE, type Pass } from '@meteor/core/models';
import { predictPasses, readOrbit } from '@meteor/orbit/propagation';
import data from '../../src/meteor_station/data/orbits.json';

const day = '2026-11-02';
const time = (value: string): number => bellTimestamp(day, value);
const orbits = data.records.map(readOrbit);
const from = Date.parse('2026-11-01T00:00:00Z');
const until = Date.parse('2026-11-03T00:00:00Z');
const allLessons = BELL_PERIODS.map((period) => period.id);
const syntheticPass: Pass = {
  id: 'test',
  norad: 57166,
  name: 'Meteor M2-3',
  start: time('09:43'),
  peak: time('09:50'),
  end: time('10:02'),
  maxElevation: 60,
  startAzimuth: 10,
  endAzimuth: 170,
  clippedStart: false,
  clippedEnd: false,
};

describe('Continuous school availability', () => {
  test('recovers the real pass across morning break and an approved Period 4', () => {
    const passes = predictPasses(orbits[0]!, SUNRISE, from, until);
    const pass = passes.find(
      (pass) => pass.start > time('09:56') && pass.start < time('09:57'),
    )!;
    expect(pass).toBeDefined();
    expect(matchPasses([pass], orbits, SUNRISE, DEFAULT_MATCH)).toEqual([]);

    const options = { ...DEFAULT_MATCH, allowedLessons: ['p4'] };
    const [window] = matchPasses([pass], orbits, SUNRISE, options);
    expect(window).toMatchObject({
      receiveFrom: pass.start,
      receiveUntil: pass.end,
      completePass: true,
      kind: 'lesson',
      label: 'Morning break + Period 4',
    });
    expect(window!.usableMinutes).toBeGreaterThan(7.7);
    expect(window!.setupAt).toBeGreaterThanOrEqual(time('09:45'));
    expect(window!.packedBy).toBeLessThanOrEqual(time('10:45'));
    expect(
      matchPasses([pass], orbits, SUNRISE, { ...options, excludedDates: [day] }),
    ).toEqual([]);
  });

  test('labels only the periods needed and retains break-only classification', () => {
    const options = { ...DEFAULT_MATCH, allowedLessons: allLessons };
    const [lunch] = schoolWindows(
      { ...syntheticPass, start: time('12:00'), end: time('12:10') },
      day,
      options,
    );
    expect(lunch).toMatchObject({ kind: 'break', label: 'Lunch', completePass: true });

    const [setupBeforeLunch] = schoolWindows(
      { ...syntheticPass, start: time('11:32'), end: time('11:42') },
      day,
      options,
    );
    expect(setupBeforeLunch).toMatchObject({
      kind: 'lesson',
      label: 'Period 5 + Lunch',
    });
  });

  test('merges overlapping periods but preserves gaps and unapproved lessons', () => {
    const periods: BellPeriod[] = [
      { id: 'a', label: 'Break', kind: 'break', from: '09:30', until: '10:00' },
      { id: 'b', label: 'Lesson B', kind: 'lesson', from: '09:55', until: '10:15' },
      { id: 'c', label: 'Lesson C', kind: 'lesson', from: '10:20', until: '10:45' },
    ];
    const options = { ...DEFAULT_MATCH, allowedLessons: ['b', 'c'] };
    const overlapPass = { ...syntheticPass, start: time('09:58'), end: time('10:08') };
    const [joined] = schoolWindows(overlapPass, day, options, periods);
    expect(joined).toMatchObject({
      receiveFrom: time('09:58'),
      receiveUntil: time('10:08'),
      label: 'Break + Lesson B',
    });
    expect(
      schoolWindows(overlapPass, day, { ...options, allowedLessons: ['c'] }, periods),
    ).toEqual([]);

    const separated = schoolWindows(
      { ...syntheticPass, start: time('10:08'), end: time('10:28') },
      day,
      options,
      periods,
    );
    expect(separated).toHaveLength(2);
    expect(separated[0]!.packedBy).toBe(time('10:15'));
    expect(separated[1]!.setupAt).toBe(time('10:20'));
  });
});

describe('Reception selection after recalculation', () => {
  test('preserves the real M2-4 selection when its rounded rise-time ID changes', () => {
    const calculate = (now: number) =>
      matchPasses(
        orbits.flatMap((orbit) => predictPasses(orbit, SUNRISE, now, until)),
        orbits,
        SUNRISE,
        { ...DEFAULT_MATCH, anyTime: true, notBefore: now },
      );
    const before = calculate(from);
    const selected = before.find((window) => window.pass.id === '59051-1793606356')!;
    expect(selected).toBeDefined();
    const after = calculate(from + 60500);
    const preserved = preserveReceptionWindow(selected, after)!;
    expect(preserved).toBeDefined();
    expect(preserved.pass.id).not.toBe(selected.pass.id);
    expect(preserved.pass.norad).toBe(selected.pass.norad);
    expect(Math.abs(preserved.pass.start - selected.pass.start)).toBeLessThan(250);
    expect(preserved.label).toBe(selected.label);
    expect(preserved).not.toBe(after[0]);
  });

  test('keeps a passage through a small orbit refresh and retains its window', () => {
    const previous = anyTimeWindow(syntheticPass, DEFAULT_MATCH)!;
    const revised = anyTimeWindow(
      {
        ...syntheticPass,
        id: 'refreshed',
        start: syntheticPass.start + 30000,
        peak: syntheticPass.peak + 30000,
        end: syntheticPass.end + 30000,
      },
      DEFAULT_MATCH,
    )!;
    expect(preserveReceptionWindow(previous, [revised])).toBe(revised);

    const breakWindow = overlapWindow(
      syntheticPass,
      BELL_PERIODS.find((period) => period.id === 'break1')!,
      day,
      DEFAULT_MATCH,
    )!;
    const shortened = { ...breakWindow, receiveFrom: time('09:51') };
    const otherAvailability = {
      ...breakWindow,
      label: 'Morning break + Period 4',
      kind: 'lesson' as const,
      receiveUntil: time('10:00'),
    };
    expect(preserveReceptionWindow(breakWindow, [otherAvailability, shortened])).toBe(
      shortened,
    );
  });

  test('does not replace an absent or expired window with another passage', () => {
    const previous = overlapWindow(
      syntheticPass,
      BELL_PERIODS.find((period) => period.id === 'break1')!,
      day,
      DEFAULT_MATCH,
    )!;
    const differentSatellite = {
      ...previous,
      pass: { ...previous.pass, norad: 59051 },
    };
    const adjacentPass = {
      ...previous,
      pass: {
        ...previous.pass,
        start: previous.pass.end,
        end: previous.pass.end + 600000,
      },
      receiveFrom: previous.pass.end,
      receiveUntil: previous.pass.end + 600000,
    };
    const disjointWindow = {
      ...previous,
      label: 'Period 4',
      receiveFrom: time('09:58'),
      receiveUntil: time('10:02'),
    };
    expect(preserveReceptionWindow(null, [previous])).toBeNull();
    expect(preserveReceptionWindow(previous, [])).toBeNull();
    expect(
      preserveReceptionWindow(previous, [
        differentSatellite,
        adjacentPass,
        disjointWindow,
      ]),
    ).toBeNull();
  });
});
