import { describe, expect, test } from 'vitest';
import {
  bellTimestamp,
  overlapWindow,
  matchPasses,
  schoolDate,
  DEFAULT_MATCH,
  parseSchoolDates,
} from '@meteor/timetable/matching';
import { BELL_PERIODS } from '@meteor/timetable/school';
import { SUNRISE, observerFromJson, type Pass } from '@meteor/core/models';
import { predictPasses } from '@meteor/orbit/propagation';
import { parseSnapshot, snapshotOrbits } from '@meteor/orbit/catalog';
import data from '../../src/meteor_station/data/orbits.json';

const day = '2026-10-29';
const time = (value: string): number => bellTimestamp(day, value);
const pass: Pass = {
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

describe('School availability', () => {
  test('rejects impossible exclusion dates and removes duplicates', () => {
    // Arrange / Act / Assert
    expect(parseSchoolDates('2026-11-02, 2026-11-02')).toEqual(['2026-11-02']);
    expect(parseSchoolDates('')).toEqual([]);
    for (const value of ['2026-99-99', '2026-02-30', 'next Friday']) {
      expect(() => parseSchoolDates(value)).toThrow('valid dates');
    }
  });
  test('reserves setup and pack-away time within the morning break', () => {
    // Arrange
    const period = BELL_PERIODS.find((value) => value.id === 'break1')!;
    // Act
    const window = overlapWindow(pass, period, day, DEFAULT_MATCH)!;
    // Assert
    expect(window.setupAt).toBe(time('09:45'));
    expect(window.receiveFrom).toBe(time('09:50'));
    expect(window.receiveUntil).toBe(time('09:57'));
    expect(window.packedBy).toBe(time('10:00'));
    expect(window.usableMinutes).toBe(7);
    expect(window.completePass).toBe(false);
  });
  test('does not recommend a window too short to receive useful data', () => {
    // Arrange
    const period = BELL_PERIODS.find((value) => value.id === 'break1')!;
    // Act / Assert
    expect(
      overlapWindow({ ...pass, end: time('09:52') }, period, day, DEFAULT_MATCH),
    ).toBeNull();
    expect(
      overlapWindow(pass, period, day, { ...DEFAULT_MATCH, notBefore: time('09:51') }),
    ).toBeNull();
    expect(() =>
      overlapWindow(pass, period, day, { ...DEFAULT_MATCH, setupMinutes: -1 }),
    ).toThrow();
  });
  test('uses school-local dates and validates observer coordinates', () => {
    // Arrange / Act / Assert
    expect(schoolDate(Date.parse('2026-10-28T18:00:00Z'))).toBe(day);
    expect(observerFromJson(SUNRISE)).toEqual(SUNRISE);
    expect(() => observerFromJson({ latitude: 91, longitude: 106 })).toThrow();
  });
  test('excludes weekends and holidays while allowing approved periods', () => {
    // Arrange
    const orbits = snapshotOrbits(parseSnapshot(data));
    const passes = orbits.flatMap((orbit) =>
      predictPasses(
        orbit,
        SUNRISE,
        Date.parse('2026-10-29T00:00:00Z'),
        Date.parse('2026-11-05T00:00:00Z'),
      ),
    );
    // Act
    const result = matchPasses(passes, orbits, SUNRISE, {
      ...DEFAULT_MATCH,
      allowedLessons: BELL_PERIODS.map((period) => period.id),
      excludedDates: [day],
    });
    // Assert
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((window) => window.kind === 'lesson')).toBe(true);
    for (const window of result) {
      expect(['2026-10-29', '2026-10-31', '2026-11-01']).not.toContain(
        schoolDate(window.receiveFrom),
      );
      expect(window.packedBy).toBeGreaterThan(window.receiveUntil);
      expect(window.maxElevation).toBeLessThanOrEqual(window.pass.maxElevation + 0.01);
    }
  });
});
