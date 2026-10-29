import { describe, expect, test } from 'vitest';
import { FmCheck, measureIq } from '@meteor/radio/fm';

describe('96.5 MHz mono-FM audio path', () => {
  test('recovers a known audio tone continuously across arbitrary USB blocks', () => {
    // Arrange: synthesized 1 kHz tone, 25 kHz deviation, 288 kS/s RF samples.
    const rate = 288000;
    const iq = new Uint8Array(rate * 2);
    let phase = 0;
    for (let i = 0; i < rate; i++) {
      phase += (2 * Math.PI * 25000 * Math.sin((2 * Math.PI * 1000 * i) / rate)) / rate;
      iq[i * 2] = Math.round(127.5 + 90 * Math.cos(phase));
      iq[i * 2 + 1] = Math.round(127.5 + 90 * Math.sin(phase));
    }
    // Act
    const full = new FmCheck(rate).push(iq);
    const streaming = new FmCheck(rate);
    const chunks: number[] = [];
    for (let i = 0; i < iq.length; i += 8190)
      chunks.push(...streaming.push(iq.subarray(i, i + 8190)));
    let real = 0,
      imaginary = 0,
      power = 0;
    for (let i = 4800; i < full.length; i++) {
      const angle = (2 * Math.PI * 1000 * i) / 48000;
      real += full[i]! * Math.cos(angle);
      imaginary += full[i]! * Math.sin(angle);
      power += full[i]! ** 2;
    }
    const n = full.length - 4800;
    // Assert: >99% of steady-state audio energy is in the original tone.
    expect(full.length).toBe(48000);
    expect(chunks).toEqual(Array.from(full));
    expect((2 * (real ** 2 + imaginary ** 2)) / (n * power)).toBeGreaterThan(0.99);
    expect(measureIq(iq).clippedFraction).toBe(0);
    expect(measureIq(iq).rms).toBeGreaterThan(0.4);
  });
  test('rejects incomplete IQ and reports clipping without pretending to measure SNR', () => {
    // Arrange / Act / Assert
    expect(() => new FmCheck(8000)).toThrow();
    expect(() => new FmCheck(288000).push(new Uint8Array(3))).toThrow();
    expect(() => measureIq(new Uint8Array(1))).toThrow();
    expect(measureIq(new Uint8Array([0, 255])).clippedFraction).toBe(1);
    expect(measureIq(new Uint8Array()).samples).toBe(0);
  });
});
