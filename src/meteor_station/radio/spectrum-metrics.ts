/** Display-only spectrum statistics. These are not RF calibration or satellite detection. */
export interface SpectrumReadout {
  readonly peakFrequencyHz: number;
  readonly peakDbfs: number;
  readonly baselineDbfs: number;
  readonly aboveFloorDb: number;
}

export function summarizeSpectrum(
  bins: Float32Array,
  centerHz: number,
  sampleRate: number,
): SpectrumReadout | null {
  if (bins.length < 32 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const middle = Math.floor(bins.length / 2);
  const values: number[] = [];
  let bestIndex = -1;
  let best = -Infinity;
  for (let i = 2; i < bins.length - 2; i++) {
    // A narrow center spike is often an RTL-SDR DC artifact. Do not present it as a signal.
    if (Math.abs(i - middle) <= 5) continue;
    const value = bins[i]!;
    if (!Number.isFinite(value)) continue;
    values.push(value);
    const neighbours = [bins[i - 1]!, value, bins[i + 1]!];
    if (neighbours.every(Number.isFinite)) {
      const smoothed = neighbours.reduce((sum, db) => sum + db, 0) / 3;
      if (smoothed > best) {
        best = smoothed;
        bestIndex = i;
      }
    }
  }
  if (bestIndex === -1 || !values.length) return null;
  values.sort((a, b) => a - b);
  const baselineDbfs = values[Math.floor(values.length / 2)]!;
  return {
    peakFrequencyHz: centerHz + ((bestIndex - bins.length / 2) * sampleRate) / bins.length,
    peakDbfs: best,
    baselineDbfs,
    aboveFloorDb: Math.max(0, best - baselineDbfs),
  };
}
