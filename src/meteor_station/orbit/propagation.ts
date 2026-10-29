/** SGP4 orbit propagation, threshold crossings, and pass predictions. */
import {
  json2satrec,
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  ecfToLookAngles,
  radiansToDegrees,
  degreesToRadians,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js';
import type { Observer, Pass, SatellitePosition } from '@meteor/core/models';
import { StationError, requireFinite } from '@meteor/core/errors';

export interface Orbit {
  readonly record: OMMJsonObject;
  readonly satrec: SatRec;
  readonly epoch: number;
  readonly norad: number;
  readonly name: string;
}

export function readOrbit(value: unknown): Orbit {
  if (!value || typeof value !== 'object')
    throw new StationError('Invalid orbital elements.');
  const record = value as OMMJsonObject;
  const norad = Number(record.NORAD_CAT_ID);
  if (![57166, 59051].includes(norad))
    throw new StationError('Expected Meteor M2-3 or M2-4 elements.');
  requireFinite(Number(record.MEAN_MOTION), 'Mean motion', 10, 18);
  requireFinite(Number(record.ECCENTRICITY), 'Eccentricity', 0, 0.2);
  for (const key of [
    'INCLINATION',
    'RA_OF_ASC_NODE',
    'ARG_OF_PERICENTER',
    'MEAN_ANOMALY',
    'BSTAR',
  ] as const) {
    requireFinite(
      Number(record[key]),
      key,
      key === 'BSTAR' ? -1 : 0,
      key === 'BSTAR' ? 1 : 360,
    );
  }
  const rawEpoch = String(record.EPOCH);
  const epoch = Date.parse(
    /Z|[+-]\d\d:\d\d$/.test(rawEpoch) ? rawEpoch : `${rawEpoch}Z`,
  );
  if (!Number.isFinite(epoch))
    throw new StationError('Orbital epoch is missing or invalid.');
  const satrec = json2satrec(record);
  if (satrec.error) throw new StationError('SGP4 rejected these orbital elements.');
  return Object.freeze({
    record,
    satrec,
    epoch,
    norad,
    name: norad === 57166 ? 'Meteor M2-3' : 'Meteor M2-4',
  });
}

export function positionAt(
  orbit: Orbit,
  at: number,
  observer: Observer,
): SatellitePosition {
  const result = propagate(orbit.satrec, new Date(at));
  if (!result || !result.position)
    throw new StationError(`Cannot propagate ${orbit.name} at this time.`);
  const sidereal = gstime(new Date(at));
  const geo = eciToGeodetic(result.position, sidereal);
  const look = ecfToLookAngles(
    {
      latitude: degreesToRadians(observer.latitude),
      longitude: degreesToRadians(observer.longitude),
      height: observer.heightKm,
    },
    eciToEcf(result.position, sidereal),
  );
  return {
    latitude: radiansToDegrees(geo.latitude),
    longitude: radiansToDegrees(geo.longitude),
    altitudeKm: geo.height,
    azimuth: radiansToDegrees(look.azimuth),
    elevation: radiansToDegrees(look.elevation),
    rangeKm: look.rangeSat,
  };
}

export function peakBetween(
  orbit: Orbit,
  observer: Observer,
  start: number,
  end: number,
): { time: number; elevation: number } {
  let low = start;
  let high = end;
  while (high - low > 500) {
    const third = (high - low) / 3;
    if (
      positionAt(orbit, low + third, observer).elevation <
      positionAt(orbit, high - third, observer).elevation
    )
      low += third;
    else high -= third;
  }
  const time = (low + high) / 2;
  return { time, elevation: positionAt(orbit, time, observer).elevation };
}

export function predictPasses(
  orbit: Orbit,
  observer: Observer,
  from: number,
  until: number,
  minElevation = 10,
): Pass[] {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    until <= from ||
    until - from > 15 * 86400000
  ) {
    throw new StationError(
      'Choose a prediction interval between one second and 15 days.',
    );
  }
  requireFinite(minElevation, 'Minimum elevation', 0, 85);
  const elevation = (at: number): number => positionAt(orbit, at, observer).elevation;
  const crossing = (lo: number, hi: number, rising: boolean): number => {
    while (hi - lo > 250) {
      const mid = (lo + hi) / 2;
      if (elevation(mid) >= minElevation === rising) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const passes: Pass[] = [];
  let previous = from;
  let wasAbove = elevation(from) >= minElevation;
  let start: number | null = wasAbove ? from : null;
  const append = (end: number, clippedEnd: boolean): void => {
    if (start === null) return;
    const peak = peakBetween(orbit, observer, start, end);
    passes.push(
      Object.freeze({
        id: `${orbit.norad}-${Math.round(start / 1000)}`,
        norad: orbit.norad,
        name: orbit.name,
        start,
        peak: peak.time,
        end,
        maxElevation: peak.elevation,
        startAzimuth: positionAt(orbit, start, observer).azimuth,
        endAzimuth: positionAt(orbit, end, observer).azimuth,
        clippedStart: start === from,
        clippedEnd,
      }),
    );
  };
  for (let time = from + 20000; ; time += 20000) {
    time = Math.min(time, until);
    const above = elevation(time) >= minElevation;
    if (above && !wasAbove) start = crossing(previous, time, true);
    if (!above && wasAbove) {
      append(crossing(previous, time, false), false);
      start = null;
    }
    previous = time;
    wasAbove = above;
    if (time === until) break;
  }
  if (start !== null) append(until, true);
  return passes;
}

export function orbitAgeDays(orbit: Orbit, at = Date.now()): number {
  return (at - orbit.epoch) / 86400000;
}
