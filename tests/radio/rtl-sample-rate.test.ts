import { describe, expect, test, vi } from 'vitest';
import { RTL2832U } from '@jtarrio/webrtlsdr/rtlsdr.js';
import { FmCheck } from '@meteor/radio/fm';

describe('production RTL2832U sample-rate calculation', () => {
  test('reports the actual 288 kS/s rate and supplies one second of FM audio', async () => {
    // Exercise the installed, patched dependency; only USB register writes are
    // stubbed. Its TS-private constructor initializes the real driver state.
    const setDemodReg = vi.fn().mockResolvedValue(undefined);
    const device = Reflect.construct(RTL2832U, [{ setDemodReg }, {}]) as RTL2832U;

    const rate = await device.setSampleRate(288000);
    const audio = new FmCheck(rate).push(new Uint8Array(288000 * 2).fill(128));

    expect(rate).toBe(288000);
    expect(audio).toHaveLength(48000);
    // Preserve the hardware register encoding; bit 28 is reconstructed only
    // when computing the reported physical rate, as in native librtlsdr.
    expect(setDemodReg.mock.calls.slice(0, 2)).toEqual([
      [1, 0x9f, 0x0900, 2],
      [1, 0xa1, 0, 2],
    ]);
  });

  test('retains the normal high-rate configuration', async () => {
    const setDemodReg = vi.fn().mockResolvedValue(undefined);
    const device = Reflect.construct(RTL2832U, [{ setDemodReg }, {}]) as RTL2832U;

    expect(await device.setSampleRate(1024000)).toBe(1024000);
    expect(setDemodReg.mock.calls.slice(0, 2)).toEqual([
      [1, 0x9f, 0x0708, 2],
      [1, 0xa1, 0, 2],
    ]);
  });
});
