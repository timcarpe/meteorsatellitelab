/** Windowed complex-IQ spectrum. Values are relative dBFS, never calibrated dBm. */
import { StationError } from '@meteor/core/errors';

export const SPECTRUM_BINS = 512;
const WINDOW = Float64Array.from(
  { length: SPECTRUM_BINS },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SPECTRUM_BINS - 1)),
);
const WINDOW_SUM = WINDOW.reduce((sum, value) => sum + value, 0);

/** Average up to four Hann-windowed FFTs spread across the supplied CU8 block. */
export function iqSpectrum(bytes: Uint8Array): Float32Array {
  if (bytes.length % 2 || bytes.length < SPECTRUM_BINS * 2)
    throw new StationError('Spectrum requires at least 512 complete I/Q samples.');
  const count = Math.min(4, Math.floor(bytes.length / (SPECTRUM_BINS * 2)));
  const power = new Float64Array(SPECTRUM_BINS);
  for (let block = 0; block < count; block++) {
    const offset =
      count === 1
        ? 0
        : Math.floor((block * (bytes.length / 2 - SPECTRUM_BINS)) / (count - 1));
    const real = new Float64Array(SPECTRUM_BINS);
    const imaginary = new Float64Array(SPECTRUM_BINS);
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      real[i] = ((bytes[2 * (offset + i)]! - 127.5) / 127.5) * WINDOW[i]!;
      imaginary[i] = ((bytes[2 * (offset + i) + 1]! - 127.5) / 127.5) * WINDOW[i]!;
    }
    // Radix-2 FFT with in-place bit reversal.
    for (let i = 1, j = 0; i < SPECTRUM_BINS; i++) {
      let bit = SPECTRUM_BINS >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j]!, real[i]!];
        [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!];
      }
    }
    for (let size = 2; size <= SPECTRUM_BINS; size *= 2) {
      for (let start = 0; start < SPECTRUM_BINS; start += size) {
        for (let k = 0; k < size / 2; k++) {
          const angle = (-2 * Math.PI * k) / size;
          const a = start + k;
          const b = a + size / 2;
          const tr = Math.cos(angle) * real[b]! - Math.sin(angle) * imaginary[b]!;
          const ti = Math.sin(angle) * real[b]! + Math.cos(angle) * imaginary[b]!;
          real[b] = real[a]! - tr;
          imaginary[b] = imaginary[a]! - ti;
          real[a] = real[a]! + tr;
          imaginary[a] = imaginary[a]! + ti;
        }
      }
    }
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const shifted = (i + SPECTRUM_BINS / 2) % SPECTRUM_BINS;
      power[i] =
        power[i]! +
        (real[shifted]! ** 2 + imaginary[shifted]! ** 2) / (count * WINDOW_SUM ** 2);
    }
  }
  return Float32Array.from(power, (value) =>
    Math.max(-100, 10 * Math.log10(Math.max(1e-10, value))),
  );
}
