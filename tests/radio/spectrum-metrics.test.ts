import { describe, expect, test } from 'vitest';
import { summarizeSpectrum } from '@meteor/radio/spectrum-metrics';

describe('Spectrum display metrics', () => {
  test('ignores receiver DC and reports a genuine off-centre peak', () => {
    const bins = new Float32Array(512).fill(-82);
    bins.fill(-1, 253, 260);
    bins.fill(-40, 319, 322);
    const result = summarizeSpectrum(bins, 137900000, 288000)!;
    expect(result.peakFrequencyHz).toBeCloseTo(137900000 + (320 - 256) * 562.5, 0);
    expect(result.peakDbfs).toBe(-40);
    expect(result.baselineDbfs).toBe(-82);
    expect(result.aboveFloorDb).toBe(42);
  });
  test('does not manufacture signal evidence for an empty or flat spectrum', () => {
    expect(summarizeSpectrum(new Float32Array(), 137900000, 288000)).toBeNull();
    const flat = summarizeSpectrum(new Float32Array(512).fill(-90), 137900000, 288000)!;
    expect(flat.aboveFloorDb).toBe(0);
    expect(flat.baselineDbfs).toBe(-90);
  });
  test('handles invalid measurements and unlabelled frequencies', () => {
    const bins = new Float32Array(512).fill(-75);
    bins[10] = NaN;
    expect(summarizeSpectrum(bins, 0, 288000)!.aboveFloorDb).toBe(0);
    expect(summarizeSpectrum(bins, 0, 0)).toBeNull();
  });
});
