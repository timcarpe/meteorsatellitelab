import { describe, expect, test } from 'vitest';
import { iqSpectrum, SPECTRUM_BINS } from '@meteor/radio/spectrum';

describe('Measured IQ spectrum', () => {
  test.each([-64, 0, 64])('places a known complex tone at bin offset %i', (offset) => {
    // Arrange: a half-scale tone exactly on an FFT bin.
    const bytes = new Uint8Array(SPECTRUM_BINS * 2 * 4);
    for (let i = 0; i < bytes.length / 2; i++) {
      const phase = (2 * Math.PI * offset * i) / SPECTRUM_BINS;
      bytes[2 * i] = Math.round(127.5 + 63.75 * Math.cos(phase));
      bytes[2 * i + 1] = Math.round(127.5 + 63.75 * Math.sin(phase));
    }
    // Act
    const spectrum = iqSpectrum(bytes);
    const peak = Math.max(...spectrum);
    // Assert: negative frequencies are on the left, positive on the right.
    expect(spectrum.indexOf(peak)).toBe(SPECTRUM_BINS / 2 + offset);
    expect(peak).toBeCloseTo(-6.02, 0);
    expect([...spectrum].every(Number.isFinite)).toBe(true);
  });
  test('rejects partial samples and undersized blocks', () => {
    // Arrange
    const short = new Uint8Array(512);
    const partial = new Uint8Array(1025);
    // Act / Assert
    expect(() => iqSpectrum(short)).toThrow('complete I/Q');
    expect(() => iqSpectrum(partial)).toThrow('complete I/Q');
  });
});
