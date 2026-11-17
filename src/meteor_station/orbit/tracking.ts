/** Live tracking of one pass: where the satellite is now and where it goes next. */
import type { Observer, Pass } from '@meteor/core/models';
import { positionAt, type Orbit } from '@meteor/orbit/propagation';

export interface SkyPoint {
  readonly time: number;
  readonly azimuth: number;
  readonly elevation: number;
}
export type PassPhase =
  | { readonly phase: 'before'; readonly untilRise: number }
  | { readonly phase: 'up'; readonly untilSet: number; readonly untilPeak: number }
  | { readonly phase: 'after'; readonly sinceSet: number };

const SPEED_OF_LIGHT = 299792458;

/** Where a pass stands at `now`; durations are in milliseconds. */
export function passPhase(pass: Pass, now: number): PassPhase {
  if (now < pass.start) return { phase: 'before', untilRise: pass.start - now };
  if (now > pass.end) return { phase: 'after', sinceSet: now - pass.end };
  return { phase: 'up', untilSet: pass.end - now, untilPeak: pass.peak - now };
}

/** The pass's path across the sky, sampled at a fixed step and ending exactly at set. */
export function passTrack(
  orbit: Orbit,
  observer: Observer,
  pass: Pass,
  stepMs = 10000,
): SkyPoint[] {
  const points: SkyPoint[] = [];
  for (let time = pass.start; ; time = Math.min(time + stepMs, pass.end)) {
    const { azimuth, elevation } = positionAt(orbit, time, observer);
    points.push({ time, azimuth, elevation });
    if (time === pass.end) break;
  }
  return points;
}

/** Received-frequency offset from range rate: positive while the satellite approaches. */
export function dopplerHz(
  orbit: Orbit,
  observer: Observer,
  at: number,
  carrierHz: number,
): number {
  const before = positionAt(orbit, at - 500, observer).rangeKm;
  const after = positionAt(orbit, at + 500, observer).rangeKm;
  const rangeRate = (after - before) * 1000; // metres per second
  return (-rangeRate / SPEED_OF_LIGHT) * carrierHz;
}

/** "4:05" style durations for countdowns; hours appear only when needed. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
