/** Offline-first orbital catalogue; element epoch determines prediction freshness. */
import bundled from '@meteor/data/orbits.json';
import { readOrbit, type Orbit } from '@meteor/orbit/propagation';
import { StationError } from '@meteor/core/errors';

export interface OrbitSnapshot {
  readonly schemaVersion: 1;
  readonly fetchedAt: string;
  readonly source: string;
  readonly records: readonly unknown[];
}
export function parseSnapshot(value: unknown): OrbitSnapshot {
  const data = value as Partial<OrbitSnapshot> | null;
  if (
    !data ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.records) ||
    data.records.length !== 2 ||
    typeof data.source !== 'string' ||
    typeof data.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(data.fetchedAt))
  ) {
    throw new StationError(
      'This orbit file must contain both Meteor satellites and its source date.',
    );
  }
  const orbits = data.records.map(readOrbit);
  if (new Set(orbits.map((orbit) => orbit.norad)).size !== 2) {
    throw new StationError('The orbit file contains a duplicate satellite.');
  }
  return Object.freeze({
    schemaVersion: 1,
    fetchedAt: data.fetchedAt,
    source: data.source,
    records: data.records,
  });
}
export function initialSnapshot(): OrbitSnapshot {
  try {
    const saved = localStorage.getItem('meteor.orbits.v1');
    if (saved) {
      const candidate = parseSnapshot(JSON.parse(saved));
      if (Date.parse(candidate.fetchedAt) > Date.parse(bundled.fetchedAt))
        return candidate;
    }
  } catch {
    /* Corrupt or unavailable local storage cannot disable the station. */
  }
  return parseSnapshot(bundled);
}
export function snapshotOrbits(snapshot: OrbitSnapshot): Orbit[] {
  return snapshot.records.map(readOrbit);
}
export async function refreshSnapshot(): Promise<OrbitSnapshot> {
  const hostedApi = import.meta.env.VITE_ORBIT_API as string | undefined;
  const url = location.protocol === 'file:' ? hostedApi : '/api/orbits';
  if (!url)
    throw new StationError(
      'This downloaded copy is using its saved orbit data. Import an updated orbit file or visit the hosted station to refresh.',
    );
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok)
    throw new StationError(
      'Orbit refresh is temporarily unavailable. The saved elements are still available.',
    );
  const result = parseSnapshot(await response.json());
  try {
    localStorage.setItem('meteor.orbits.v1', JSON.stringify(result));
  } catch {
    /* Optional cache. */
  }
  return result;
}
