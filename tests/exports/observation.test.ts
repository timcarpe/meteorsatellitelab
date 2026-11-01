import { describe, expect, test, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { saveObservation } from '@meteor/exports/observation';
import { SUNRISE } from '@meteor/core/models';
import { parseSnapshot } from '@meteor/orbit/catalog';
import { downloadBlob } from '@meteor/ui/format';
import orbits from '../../src/meteor_station/data/orbits.json';

vi.mock('@meteor/ui/format', () => ({ downloadBlob: vi.fn() }));

describe('Observation export', () => {
  test('keeps the rendered image metadata when a new session resets the canvas', async () => {
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    let completePng!: BlobCallback;
    const canvas = {
      width: 1,
      height: 1,
      toBlob(callback: BlobCallback) {
        completePng = callback;
      },
    } as HTMLCanvasElement;
    const renderedChannel = 2;

    const saving = saveObservation(
      canvas,
      new ArrayBuffer(1024),
      {
        mode: 'replay',
        sampleRate: 288000,
        frequency: 0,
        startedAt: '2026-11-01T00:00:00.000Z',
      },
      SUNRISE,
      parseSnapshot(orbits),
      null,
      [1, 2],
      renderedChannel,
    );
    // Canvas.toBlob captures pixels at invocation, but returns them asynchronously.
    canvas.width = 0;
    canvas.height = 0;
    completePng(new Blob([png], { type: 'image/png' }));
    await saving;

    expect(downloadBlob).toHaveBeenCalledOnce();
    const [archive] = vi.mocked(downloadBlob).mock.calls[0]!;
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const metadata = JSON.parse(strFromU8(files['metadata.json']!));
    expect(files['weather-image.png']).toEqual(png);
    expect(metadata.image).toMatchObject({
      width: 1,
      height: 1,
      channels: [1, 2],
      selectedChannel: renderedChannel,
    });
  });
});
