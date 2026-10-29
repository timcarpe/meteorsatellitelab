import { afterEach, describe, expect, test, vi } from 'vitest';
import data from '../../src/meteor_station/data/orbits.json';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('Shared orbit endpoint', () => {
  test('coalesces concurrent requests and rejects writes', async () => {
    // Arrange
    vi.resetModules();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data.records)));
    vi.stubGlobal('fetch', fetch);
    const { handleOrbitRequest } = await import('@meteor/server/orbits');
    // Act
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        handleOrbitRequest(new Request('https://station.test/api/orbits')),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const rejected = await handleOrbitRequest(
      new Request('https://station.test/api/orbits', { method: 'POST' }),
    );
    const head = await handleOrbitRequest(
      new Request('https://station.test/api/orbits', { method: 'HEAD' }),
    );
    // Assert
    expect(fetch).toHaveBeenCalledOnce();
    expect(bodies.every((value) => value.records.length === 2)).toBe(true);
    expect(responses[0]!.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(rejected.status).toBe(405);
    expect(await head.text()).toBe('');
  });
  test('preserves the original date and backs off after an upstream failure', async () => {
    // Arrange
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const { handleOrbitRequest } = await import('@meteor/server/orbits');
    // Act
    const response = await handleOrbitRequest(
      new Request('https://station.test/api/orbits'),
    );
    await handleOrbitRequest(new Request('https://station.test/api/orbits'));
    // Assert
    expect((await response.json()).fetchedAt).toBe(data.fetchedAt);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
