/** Public orbit endpoint: one weather catalogue fetch, shared CDN caching. */
import bundled from '../data/orbits.json' with { type: 'json' };

const TTL = 2 * 60 * 60 * 1000;
let refreshedAt = 0;
let cached: unknown = bundled;
let pending: Promise<unknown> | null = null;

async function fetchSnapshot(): Promise<unknown> {
  const response = await fetch(bundled.source, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'MeteorStation/0.1 (educational orbit cache)' },
  });
  if (!response.ok) throw new Error(`CelesTrak returned ${response.status}`);
  const text = await response.text();
  if (text.length > 1000000) throw new Error('Orbit catalogue exceeded expected size');
  const values: unknown = JSON.parse(text);
  if (!Array.isArray(values)) throw new Error('Invalid orbit catalogue');
  const records = values.filter((record) =>
    [57166, 59051].includes(record?.NORAD_CAT_ID),
  );
  if (
    records.length !== 2 ||
    records.some(
      (record) =>
        typeof record.EPOCH !== 'string' || !Number.isFinite(record.MEAN_MOTION),
    )
  ) {
    throw new Error('The catalogue did not contain both Meteor orbits');
  }
  return {
    schemaVersion: 1,
    source: bundled.source,
    fetchedAt: new Date().toISOString(),
    records,
  };
}

export async function handleOrbitRequest(request: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=86400',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }
  if (pending || Date.now() - refreshedAt >= TTL) {
    pending ??= (async () => {
      // Back off on upstream failure too; never turn student refreshes into retries.
      refreshedAt = Date.now();
      try {
        cached = await fetchSnapshot();
      } catch (error) {
        console.error('Orbit refresh failed; serving dated snapshot:', error);
      }
      return cached;
    })();
    try {
      await pending;
    } finally {
      pending = null;
    }
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(cached), {
    headers,
  });
}
