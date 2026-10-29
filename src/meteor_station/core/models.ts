/** Validated immutable station configuration and prediction types. */
import { requireFinite } from '@meteor/core/errors';

export interface Observer {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly heightKm: number;
}
export function observerFromJson(value: unknown): Observer {
  const data = value as Partial<Observer> | null;
  return Object.freeze({
    name: typeof data?.name === 'string' ? data.name.slice(0, 100) : 'My location',
    latitude: requireFinite(data?.latitude, 'Latitude', -90, 90),
    longitude: requireFinite(data?.longitude, 'Longitude', -180, 180),
    heightKm: requireFinite(data?.heightKm ?? 0, 'Height (km)', -0.4, 9),
  });
}
export const SUNRISE = observerFromJson({
  name: 'VAS Sunrise',
  latitude: 10.7385156,
  longitude: 106.6975343,
  heightKm: 0.01,
});
export const SCHOOL_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const SCHOOL_UTC_OFFSET_MINUTES = 420;

export interface SatellitePosition {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeKm: number;
  readonly azimuth: number;
  readonly elevation: number;
  readonly rangeKm: number;
}
export interface Pass {
  readonly id: string;
  readonly norad: number;
  readonly name: string;
  readonly start: number;
  readonly peak: number;
  readonly end: number;
  readonly maxElevation: number;
  readonly startAzimuth: number;
  readonly endAzimuth: number;
  readonly clippedStart: boolean;
  readonly clippedEnd: boolean;
}
export interface ReceptionWindow {
  readonly pass: Pass;
  readonly label: string;
  readonly kind: 'break' | 'lesson' | 'outside';
  readonly setupAt: number;
  readonly receiveFrom: number;
  readonly receiveUntil: number;
  readonly packedBy: number;
  readonly usableMinutes: number;
  readonly maxElevation: number;
  readonly completePass: boolean;
}
