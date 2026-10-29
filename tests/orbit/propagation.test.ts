import { describe, expect, test, vi, afterEach } from 'vitest';
import {
  readOrbit,
  positionAt,
  predictPasses,
  orbitAgeDays,
} from '@meteor/orbit/propagation';
import { parseSnapshot, initialSnapshot, refreshSnapshot } from '@meteor/orbit/catalog';
import { SUNRISE } from '@meteor/core/models';
import data from '../../src/meteor_station/data/orbits.json';

afterEach(() => vi.unstubAllGlobals());
describe('Orbit predictions', () => {
  test('refines rise, peak, and set against the propagated sky position', () => {
    // Arrange
    const orbit = readOrbit(data.records[0]);
    // Act
    const passes = predictPasses(orbit, SUNRISE, orbit.epoch, orbit.epoch + 86400000);
    // Assert
    expect(passes.length).toBeGreaterThan(1);
    for (const pass of passes) {
      if (!pass.clippedStart)
        expect(positionAt(orbit, pass.start, SUNRISE).elevation).toBeCloseTo(10, 1);
      if (!pass.clippedEnd)
        expect(positionAt(orbit, pass.end, SUNRISE).elevation).toBeCloseTo(10, 1);
      expect(pass.maxElevation).toBeGreaterThan(10);
      expect(pass.peak).toBeGreaterThan(pass.start);
      expect(pass.peak).toBeLessThan(pass.end);
      expect(positionAt(orbit, pass.peak, SUNRISE).altitudeKm).toBeGreaterThan(700);
    }
    const pass = passes[0]!;
    const clipped = predictPasses(orbit, SUNRISE, pass.peak, pass.peak + 1000);
    expect(clipped[0]?.clippedStart).toBe(true);
    expect(clipped[0]?.clippedEnd).toBe(true);
    expect(orbitAgeDays(orbit, orbit.epoch + 86400000)).toBe(1);
  });
  test('rejects invalid elements, catalogues, and intervals', () => {
    // Arrange
    const record = data.records[0]!;
    const orbit = readOrbit(record);
    // Act / Assert
    expect(() => readOrbit(null)).toThrow();
    expect(() => readOrbit({ ...record, NORAD_CAT_ID: 1 })).toThrow();
    expect(() => readOrbit({ ...record, MEAN_MOTION: 'bad' })).toThrow();
    expect(() => readOrbit({ ...record, EPOCH: '' })).toThrow();
    expect(() => parseSnapshot({ ...data, records: [record, record] })).toThrow();
    expect(() => parseSnapshot({})).toThrow();
    expect(() => predictPasses(orbit, SUNRISE, 0, 0)).toThrow();
    expect(() => predictPasses(orbit, SUNRISE, 0, 16 * 86400000)).toThrow();
  });
  test('uses bundled elements when local storage is corrupt or missing', () => {
    // Arrange
    vi.stubGlobal('localStorage', { getItem: () => '{bad json' });
    // Act / Assert
    expect(initialSnapshot().records).toEqual(data.records);
  });
  test('refreshes the public endpoint and stores only validated data', async () => {
    // Arrange
    const save = vi.fn();
    vi.stubGlobal('location', { protocol: 'https:' });
    vi.stubGlobal('localStorage', { setItem: save });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(data))),
    );
    // Act
    const result = await refreshSnapshot();
    // Assert
    expect(result.records).toEqual(data.records);
    expect(save).toHaveBeenCalledOnce();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    );
    await expect(refreshSnapshot()).rejects.toThrow('temporarily unavailable');
  });
});
