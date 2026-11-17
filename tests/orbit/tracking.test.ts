import { describe, expect, test } from 'vitest';
import { readOrbit, positionAt, predictPasses } from '@meteor/orbit/propagation';
import { countdown, dopplerHz, passPhase, passTrack } from '@meteor/orbit/tracking';
import { skyXY } from '@meteor/map/sky';
import { SUNRISE } from '@meteor/core/models';
import data from '../../src/meteor_station/data/orbits.json';

const orbit = readOrbit(data.records[0]);
const pass = predictPasses(orbit, SUNRISE, orbit.epoch, orbit.epoch + 86400000).find(
  (item) => !item.clippedStart && !item.clippedEnd && item.maxElevation > 30,
)!;

describe('Pass tracking', () => {
  test('reports time to rise, to peak and set, and since set', () => {
    // Act / Assert
    expect(passPhase(pass, pass.start - 65000)).toEqual({
      phase: 'before',
      untilRise: 65000,
    });
    expect(passPhase(pass, pass.peak - 1000)).toEqual({
      phase: 'up',
      untilPeak: 1000,
      untilSet: pass.end - pass.peak + 1000,
    });
    expect(passPhase(pass, pass.end + 120000)).toEqual({
      phase: 'after',
      sinceSet: 120000,
    });
  });
  test('samples the sky path from rise to set, peaking where predicted', () => {
    // Act
    const track = passTrack(orbit, SUNRISE, pass, 10000);
    // Assert
    expect(track[0]!.time).toBe(pass.start);
    expect(track.at(-1)!.time).toBe(pass.end);
    const highest = Math.max(...track.map((point) => point.elevation));
    expect(highest).toBeLessThanOrEqual(pass.maxElevation + 0.01);
    expect(highest).toBeGreaterThan(pass.maxElevation - 2);
  });
  test('shifts received frequency up while approaching and down while leaving', () => {
    // Act
    const rising = dopplerHz(orbit, SUNRISE, pass.start, 137.9e6);
    const setting = dopplerHz(orbit, SUNRISE, pass.end, 137.9e6);
    const overhead = dopplerHz(orbit, SUNRISE, pass.peak, 137.9e6);
    // Assert: LEO Doppler at 137.9 MHz stays within a few kHz and crosses zero at peak.
    expect(rising).toBeGreaterThan(1000);
    expect(setting).toBeLessThan(-1000);
    expect(Math.abs(rising)).toBeLessThan(4000);
    expect(Math.abs(overhead)).toBeLessThan(Math.abs(rising) / 4);
  });
  test('formats countdowns as minutes and seconds, adding hours when needed', () => {
    expect(countdown(65400)).toBe('1:05');
    expect(countdown(-5000)).toBe('0:00');
    expect(countdown(3723000)).toBe('1:02:03');
  });
});

describe('Sky plot geometry', () => {
  test('puts overhead at the centre, north up, east right and the horizon at the edge', () => {
    // Act
    const [cx, cy] = skyXY(123, 90, 100);
    const north = skyXY(0, 0, 100);
    const east = skyXY(90, 0, 100);
    const halfway = skyXY(180, 45, 100);
    // Assert
    expect(Math.hypot(cx, cy)).toBeCloseTo(0);
    expect(north[0]).toBeCloseTo(0);
    expect(north[1]).toBeCloseTo(-100);
    expect(east[0]).toBeCloseTo(100);
    expect(east[1]).toBeCloseTo(0);
    expect(halfway[1]).toBeCloseTo(50);
    expect(skyXY(0, -10, 100)[1]).toBeCloseTo(-100);
  });
  test('places the live position consistently with the propagated look angles', () => {
    // Arrange
    const at = pass.peak;
    const position = positionAt(orbit, at, SUNRISE);
    // Act
    const [x, y] = skyXY(position.azimuth, position.elevation, 100);
    // Assert: distance from centre encodes 90° minus elevation.
    expect(Math.hypot(x, y)).toBeCloseTo((100 * (90 - position.elevation)) / 90, 5);
  });
});
